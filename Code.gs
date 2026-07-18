const PORTAL = Object.freeze({
  SHEETS: Object.freeze({
    ACTIONS: 'CourierActions',
    COMPANIES: 'CompanyDirectory',
    STAKEHOLDERS: 'Stakeholders',
    AUDIT: 'AuditLog',
  }),
  SESSION_TTL_SECONDS: 6 * 60 * 60,
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCK_SECONDS: 15 * 60,
  MAX_RESULTS: 500,
});

const ACTION_HEADERS = Object.freeze([
  'record_id',
  'ticket_id',
  'courier_id',
  'company_id',
  'fleet_company_name',
  'tag_added',
  'action',
  'action_reason',
  'terminated',
  'action_date',
  'ticket_status',
  'market',
  'handled_by',
  'notes',
  'created_at',
  'updated_at',
]);

const COMPANY_HEADERS = Object.freeze([
  'company_id',
  'fleet_company_name',
  'active',
  'contact_label',
]);

const STAKEHOLDER_HEADERS = Object.freeze([
  'stakeholder_id',
  'stakeholder_name',
  'company_id',
  'access_code_hash',
  'active',
  'created_at',
  'last_rotated_at',
]);

const AUDIT_HEADERS = Object.freeze([
  'timestamp',
  'stakeholder_id',
  'company_id',
  'event',
  'record_count',
  'detail',
]);

/** Public web-app entry point. */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Fleet Courier Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Public login endpoint. The access code is mapped to a stakeholder and company
 * on the server. The browser never chooses or supplies a company ID.
 */
function login(accessCode) {
  const code = String(accessCode || '').trim();
  if (code.length < 12 || code.length > 128) {
    throw new Error('Invalid access code.');
  }

  const rateKey = loginRateKey_(code);
  const cache = CacheService.getScriptCache();
  const attempts = Number(cache.get(rateKey) || 0);
  if (attempts >= PORTAL.MAX_LOGIN_ATTEMPTS) {
    throw new Error('Too many attempts. Please wait 15 minutes and try again.');
  }

  const stakeholder = findStakeholderByCode_(code);
  if (!stakeholder) {
    cache.put(rateKey, String(attempts + 1), PORTAL.LOGIN_LOCK_SECONDS);
    throw new Error('Invalid access code.');
  }

  const company = getCompanyById_(stakeholder.companyId);
  if (!company || !company.active) {
    throw new Error('This company account is inactive.');
  }

  cache.remove(rateKey);
  const token = createSessionToken_();
  const session = {
    stakeholderId: stakeholder.stakeholderId,
    stakeholderName: stakeholder.stakeholderName,
    companyId: stakeholder.companyId,
    companyName: company.companyName,
    createdAt: Date.now(),
    expiresAt: Date.now() + PORTAL.SESSION_TTL_SECONDS * 1000,
  };
  cache.put(sessionKey_(token), JSON.stringify(session), PORTAL.SESSION_TTL_SECONDS);
  appendAudit_(session, 'login', 0, 'Successful stakeholder login');

  return {
    token: token,
    stakeholderName: session.stakeholderName,
    companyName: session.companyName,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

/**
 * Returns company-scoped records. Filters are optional, but companyId is never
 * accepted from the client. It always comes from the authenticated session.
 */
function getPortalData(sessionToken, filters) {
  const session = requireSession_(sessionToken);
  const safeFilters = sanitiseFilters_(filters || {});
  const records = readCompanyRecords_(session.companyId, safeFilters);
  appendAudit_(session, 'view_records', records.length, JSON.stringify(safeFilters));

  const summary = records.reduce(function (acc, record) {
    acc.total += 1;
    if (record.terminated) acc.terminated += 1;
    if (record.ticketStatus.toLowerCase() === 'open') acc.openTickets += 1;
    if (record.isRecent) acc.recentActions += 1;
    return acc;
  }, { total: 0, terminated: 0, openTickets: 0, recentActions: 0 });

  records.forEach(function (record) { delete record.isRecent; });

  return {
    stakeholderName: session.stakeholderName,
    companyName: session.companyName,
    summary: summary,
    records: records,
    truncated: records.length >= PORTAL.MAX_RESULTS,
    generatedAt: new Date().toISOString(),
  };
}

/** Public logout endpoint. */
function logout(sessionToken) {
  const token = String(sessionToken || '');
  if (token) CacheService.getScriptCache().remove(sessionKey_(token));
  return true;
}

// ---------------------------------------------------------------------------
// Administrator-only helpers.
// The trailing underscore makes these functions private to Apps Script, so
// they cannot be invoked through google.script.run from the public web app.
// Run them from the bound Apps Script editor or the spreadsheet's custom menu.
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Stakeholder Portal')
    .addItem('Initialize prototype', 'setupPortal_')
    .addItem('Create stakeholder access', 'promptCreateStakeholder_')
    .addItem('Rotate stakeholder access', 'promptRotateStakeholder_')
    .addToUi();
}

function setupPortal_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open the bound spreadsheet before running setup.');

  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', spreadsheet.getId());
  ensurePepper_();

  const actions = ensureSheet_(spreadsheet, PORTAL.SHEETS.ACTIONS, ACTION_HEADERS);
  const companies = ensureSheet_(spreadsheet, PORTAL.SHEETS.COMPANIES, COMPANY_HEADERS);
  const stakeholders = ensureSheet_(spreadsheet, PORTAL.SHEETS.STAKEHOLDERS, STAKEHOLDER_HEADERS);
  const audit = ensureSheet_(spreadsheet, PORTAL.SHEETS.AUDIT, AUDIT_HEADERS);

  const demoCodes = seedSyntheticData_(actions, companies, stakeholders);
  formatDatabaseSheets_(actions, companies, stakeholders, audit);
  stakeholders.hideSheet();
  audit.hideSheet();

  const message = [
    'Prototype initialized with synthetic data.',
    '',
    'Demo access codes (shown once for testing):',
    'Northstar Logistics: ' + demoCodes.northstar,
    'Blue Harbor Fleet: ' + demoCodes.blueHarbor,
    'Cedar Route Partners: ' + demoCodes.cedarRoute,
    '',
    'Before real data is used, change the spreadsheet sharing setting to Restricted.',
  ].join('\n');
  Logger.log(message);
  SpreadsheetApp.getUi().alert('Stakeholder Portal', message, SpreadsheetApp.getUi().ButtonSet.OK);
}

function promptCreateStakeholder_() {
  const ui = SpreadsheetApp.getUi();
  const nameResponse = ui.prompt('Create access', 'Stakeholder display name:', ui.ButtonSet.OK_CANCEL);
  if (nameResponse.getSelectedButton() !== ui.Button.OK) return;
  const companyResponse = ui.prompt(
    'Create access',
    'Exact company_id from CompanyDirectory:',
    ui.ButtonSet.OK_CANCEL
  );
  if (companyResponse.getSelectedButton() !== ui.Button.OK) return;

  const result = createStakeholder_(nameResponse.getResponseText(), companyResponse.getResponseText());
  ui.alert(
    'Access code created',
    'Stakeholder ID: ' + result.stakeholderId + '\n\n' +
      'One-time access code:\n' + result.accessCode + '\n\n' +
      'Copy it now. Only its hash is stored.',
    ui.ButtonSet.OK
  );
}

function promptRotateStakeholder_() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    'Rotate access',
    'Exact stakeholder_id from the Stakeholders sheet:',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const result = rotateStakeholderCode_(response.getResponseText());
  ui.alert(
    'Access code rotated',
    'One-time access code:\n' + result.accessCode + '\n\n' +
      'The old code no longer works. Copy this code now.',
    ui.ButtonSet.OK
  );
}

function createStakeholder_(stakeholderName, companyId) {
  const cleanName = String(stakeholderName || '').trim();
  const cleanCompanyId = String(companyId || '').trim();
  if (!cleanName) throw new Error('Stakeholder name is required.');
  const company = getCompanyById_(cleanCompanyId);
  if (!company || !company.active) throw new Error('Unknown or inactive company_id.');

  const accessCode = generateAccessCode_();
  const stakeholderId = 'stk_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
  const now = new Date();
  getDb_().getSheetByName(PORTAL.SHEETS.STAKEHOLDERS).appendRow([
    stakeholderId,
    cleanName,
    cleanCompanyId,
    hashAccessCode_(accessCode),
    true,
    now,
    now,
  ]);
  return { stakeholderId: stakeholderId, accessCode: accessCode };
}

function rotateStakeholderCode_(stakeholderId) {
  const cleanId = String(stakeholderId || '').trim();
  const sheet = getDb_().getSheetByName(PORTAL.SHEETS.STAKEHOLDERS);
  const values = sheet.getDataRange().getValues();
  const headers = headerIndex_(values[0]);
  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    if (String(values[rowIndex][headers.stakeholder_id]).trim() !== cleanId) continue;
    const accessCode = generateAccessCode_();
    sheet.getRange(rowIndex + 1, headers.access_code_hash + 1).setValue(hashAccessCode_(accessCode));
    sheet.getRange(rowIndex + 1, headers.last_rotated_at + 1).setValue(new Date());
    return { stakeholderId: cleanId, accessCode: accessCode };
  }
  throw new Error('Stakeholder ID not found.');
}

// ---------------------------------------------------------------------------
// Authentication, authorisation, and data access internals.
// ---------------------------------------------------------------------------

function requireSession_(sessionToken) {
  const token = String(sessionToken || '').trim();
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(token)) throw new Error('Session expired. Please sign in again.');
  const cache = CacheService.getScriptCache();
  const raw = cache.get(sessionKey_(token));
  if (!raw) throw new Error('Session expired. Please sign in again.');

  const session = JSON.parse(raw);
  if (!session.companyId || !session.stakeholderId || Number(session.expiresAt) < Date.now()) {
    cache.remove(sessionKey_(token));
    throw new Error('Session expired. Please sign in again.');
  }

  // Sliding session expiry. Company identity remains server-controlled.
  session.expiresAt = Date.now() + PORTAL.SESSION_TTL_SECONDS * 1000;
  cache.put(sessionKey_(token), JSON.stringify(session), PORTAL.SESSION_TTL_SECONDS);
  return session;
}

function findStakeholderByCode_(accessCode) {
  const sheet = getDb_().getSheetByName(PORTAL.SHEETS.STAKEHOLDERS);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getDataRange().getValues();
  const headers = headerIndex_(values[0]);
  const candidateHash = hashAccessCode_(accessCode);

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    const active = toBoolean_(row[headers.active]);
    const storedHash = String(row[headers.access_code_hash] || '');
    if (active && constantTimeEquals_(storedHash, candidateHash)) {
      return {
        stakeholderId: String(row[headers.stakeholder_id]).trim(),
        stakeholderName: String(row[headers.stakeholder_name]).trim(),
        companyId: String(row[headers.company_id]).trim(),
      };
    }
  }
  return null;
}

function getCompanyById_(companyId) {
  const sheet = getDb_().getSheetByName(PORTAL.SHEETS.COMPANIES);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const values = sheet.getDataRange().getValues();
  const headers = headerIndex_(values[0]);
  const target = String(companyId || '').trim();

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    if (String(row[headers.company_id]).trim() === target) {
      return {
        companyId: target,
        companyName: String(row[headers.fleet_company_name]).trim(),
        active: toBoolean_(row[headers.active]),
      };
    }
  }
  return null;
}

function readCompanyRecords_(companyId, filters) {
  const sheet = getDb_().getSheetByName(PORTAL.SHEETS.ACTIONS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const headers = headerIndex_(values[0]);
  const targetCompany = String(companyId).trim();
  const now = Date.now();
  const recentCutoff = now - 30 * 24 * 60 * 60 * 1000;
  const result = [];

  for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];

    // Tenant isolation happens here, before any client-provided filters.
    if (String(row[headers.company_id]).trim() !== targetCompany) continue;

    const terminated = toBoolean_(row[headers.terminated]);
    const actionDate = coerceDate_(row[headers.action_date]);
    const ticketStatus = String(row[headers.ticket_status] || '').trim();
    const searchable = [
      row[headers.courier_id],
      row[headers.ticket_id],
      row[headers.tag_added],
      row[headers.action],
      row[headers.action_reason],
      row[headers.market],
    ].join(' ').toLowerCase();

    if (filters.query && searchable.indexOf(filters.query) === -1) continue;
    if (filters.ticketStatus && ticketStatus.toLowerCase() !== filters.ticketStatus) continue;
    if (filters.terminated === 'yes' && !terminated) continue;
    if (filters.terminated === 'no' && terminated) continue;
    if (filters.dateFrom && (!actionDate || actionDate.getTime() < filters.dateFrom.getTime())) continue;
    if (filters.dateTo) {
      const inclusiveEnd = new Date(filters.dateTo.getTime() + 24 * 60 * 60 * 1000 - 1);
      if (!actionDate || actionDate.getTime() > inclusiveEnd.getTime()) continue;
    }

    result.push({
      recordId: safeCell_(row[headers.record_id]),
      ticketId: safeCell_(row[headers.ticket_id]),
      courierId: safeCell_(row[headers.courier_id]),
      fleetCompanyName: safeCell_(row[headers.fleet_company_name]),
      tagAdded: safeCell_(row[headers.tag_added]),
      action: safeCell_(row[headers.action]),
      actionReason: safeCell_(row[headers.action_reason]),
      terminated: terminated,
      actionDate: formatDate_(actionDate),
      ticketStatus: ticketStatus,
      market: safeCell_(row[headers.market]),
      notes: safeCell_(row[headers.notes]),
      isRecent: Boolean(actionDate && actionDate.getTime() >= recentCutoff),
    });
    if (result.length >= PORTAL.MAX_RESULTS) break;
  }

  result.sort(function (a, b) { return b.actionDate.localeCompare(a.actionDate); });
  return result;
}

function sanitiseFilters_(filters) {
  const query = String(filters.query || '').trim().toLowerCase().slice(0, 100);
  const ticketStatus = String(filters.ticketStatus || '').trim().toLowerCase();
  const terminated = String(filters.terminated || '').trim().toLowerCase();
  return {
    query: query,
    ticketStatus: ['open', 'pending', 'waiting_courier', 'under_review', 'resolved', 'closed'].indexOf(ticketStatus) >= 0 ? ticketStatus : '',
    terminated: ['yes', 'no'].indexOf(terminated) >= 0 ? terminated : '',
    dateFrom: parseDateFilter_(filters.dateFrom),
    dateTo: parseDateFilter_(filters.dateTo),
  };
}

// ---------------------------------------------------------------------------
// Setup, formatting, and utility internals.
// ---------------------------------------------------------------------------

function getDb_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Portal is not initialized. Run setupPortal_ from the bound script editor.');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const existing = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (existing.join('|') !== headers.join('|')) {
      throw new Error('Unexpected headers in ' + name + '. Setup stopped without overwriting data.');
    }
  }
  return sheet;
}

function seedSyntheticData_(actions, companies, stakeholders) {
  const demoCodes = {
    northstar: 'Northstar-Demo-7K4Q',
    blueHarbor: 'BlueHarbor-Demo-8M2P',
    cedarRoute: 'CedarRoute-Demo-5R9X',
  };

  if (companies.getLastRow() === 1) {
    companies.getRange(2, 1, 3, COMPANY_HEADERS.length).setValues([
      ['cmp_northstar', 'Northstar Logistics', true, 'Operations contact'],
      ['cmp_blueharbor', 'Blue Harbor Fleet', true, 'Fleet manager'],
      ['cmp_cedarroute', 'Cedar Route Partners', true, 'Partner operations'],
    ]);
  }

  if (stakeholders.getLastRow() === 1) {
    const now = new Date();
    stakeholders.getRange(2, 1, 3, STAKEHOLDER_HEADERS.length).setValues([
      ['stk_demo_north', 'Northstar Demo Stakeholder', 'cmp_northstar', hashAccessCode_(demoCodes.northstar), true, now, now],
      ['stk_demo_blue', 'Blue Harbor Demo Stakeholder', 'cmp_blueharbor', hashAccessCode_(demoCodes.blueHarbor), true, now, now],
      ['stk_demo_cedar', 'Cedar Route Demo Stakeholder', 'cmp_cedarroute', hashAccessCode_(demoCodes.cedarRoute), true, now, now],
    ]);
  }

  if (actions.getLastRow() === 1) {
    const now = new Date();
    const daysAgo = function (days) { return new Date(now.getTime() - days * 24 * 60 * 60 * 1000); };
    const companyProfiles = [
      { id: 'cmp_northstar', name: 'Northstar Logistics', prefix: 'N' },
      { id: 'cmp_blueharbor', name: 'Blue Harbor Fleet', prefix: 'B' },
      { id: 'cmp_cedarroute', name: 'Cedar Route Partners', prefix: 'C' },
    ];
    const actionsCatalog = [
      { tag: 'Policy Review', action: 'termination', reason: 'Repeated policy breaches after prior warnings', terminated: true, status: 'closed' },
      { tag: 'Document Check', action: 'temporary_suspension', reason: 'Documents pending validation', terminated: false, status: 'waiting_courier' },
      { tag: 'Performance Watch', action: 'account_warning', reason: 'Service quality threshold missed', terminated: false, status: 'resolved' },
      { tag: 'Support Follow-up', action: 'tag_review', reason: 'Ticket classification requires review', terminated: false, status: 'under_review' },
      { tag: 'Document Check', action: 'document_request', reason: 'Updated identification requested', terminated: false, status: 'waiting_courier' },
      { tag: 'Payment Review', action: 'payment_check', reason: 'Payout discrepancy reported', terminated: false, status: 'resolved' },
      { tag: 'Reactivation', action: 'reinstatement', reason: 'Required review completed successfully', terminated: false, status: 'closed' },
      { tag: 'No Action', action: 'no_action', reason: 'Ticket evidence did not require intervention', terminated: false, status: 'closed' },
      { tag: 'Compliance Review', action: 'compliance_review', reason: 'Routine compliance sample selected', terminated: false, status: 'under_review' },
      { tag: 'Support Follow-up', action: 'support_follow_up', reason: 'Additional courier clarification requested', terminated: false, status: 'open' },
    ];
    const markets = ['Athens', 'Thessaloniki', 'Patras', 'Heraklion', 'Larissa'];
    const handlers = ['Demo Agent 01', 'Demo Agent 02', 'Demo Agent 03', 'Demo Agent 04', 'Demo Agent 05'];
    const syntheticRows = [];

    for (let index = 0; index < 200; index += 1) {
      const company = companyProfiles[index % companyProfiles.length];
      const actionInfo = actionsCatalog[(index * 7 + Math.floor(index / 9)) % actionsCatalog.length];
      const actionDate = daysAgo((index * 5) % 181);
      const updatedAt = new Date(actionDate.getTime() + ((index % 4) + 1) * 24 * 60 * 60 * 1000);
      const courierNumber = ((index * 11 + Math.floor(index / 3)) % 125) + 1;
      const sequence = String(index + 1).padStart(6, '0');

      syntheticRows.push([
        'rec_' + sequence,
        'TKT-DEMO-' + sequence,
        'CR-' + company.prefix + '-' + String(courierNumber).padStart(4, '0'),
        company.id,
        company.name,
        actionInfo.tag,
        actionInfo.action,
        actionInfo.reason,
        actionInfo.terminated,
        actionDate,
        actionInfo.status,
        markets[(index * 3) % markets.length],
        handlers[index % handlers.length],
        'Synthetic portfolio record ' + String(index + 1).padStart(3, '0') + '; contains no real courier or ticket data.',
        actionDate,
        updatedAt,
      ]);
    }
    actions.getRange(2, 1, syntheticRows.length, ACTION_HEADERS.length).setValues(syntheticRows);
  }
  return demoCodes;
}

function formatDatabaseSheets_(actions, companies, stakeholders, audit) {
  [actions, companies, stakeholders, audit].forEach(function (sheet) {
    const lastColumn = Math.max(1, sheet.getLastColumn());
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, lastColumn)
      .setBackground('#132238')
      .setFontColor('#ffffff')
      .setFontWeight('bold');
    sheet.autoResizeColumns(1, lastColumn);
  });
  actions.getRange('J:J').setNumberFormat('yyyy-mm-dd');
  actions.getRange('O:P').setNumberFormat('yyyy-mm-dd hh:mm');
  stakeholders.getRange('F:G').setNumberFormat('yyyy-mm-dd hh:mm');
  audit.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function appendAudit_(session, eventName, recordCount, detail) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return;
  try {
    const sheet = getDb_().getSheetByName(PORTAL.SHEETS.AUDIT);
    if (!sheet) return;
    sheet.appendRow([
      new Date(),
      safeCell_(session.stakeholderId),
      safeCell_(session.companyId),
      safeCell_(eventName),
      Number(recordCount || 0),
      safeCell_(detail).slice(0, 500),
    ]);
  } finally {
    lock.releaseLock();
  }
}

function headerIndex_(headers) {
  return headers.reduce(function (map, header, index) {
    map[String(header).trim()] = index;
    return map;
  }, {});
}

function ensurePepper_() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('ACCESS_CODE_PEPPER')) {
    properties.setProperty(
      'ACCESS_CODE_PEPPER',
      Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()
    );
  }
}

function hashAccessCode_(accessCode) {
  ensurePepper_();
  const pepper = PropertiesService.getScriptProperties().getProperty('ACCESS_CODE_PEPPER');
  const bytes = Utilities.computeHmacSha256Signature(String(accessCode), pepper);
  return Utilities.base64EncodeWebSafe(bytes);
}

function constantTimeEquals_(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index % Math.max(1, a.length)) || 0) ^
      (b.charCodeAt(index % Math.max(1, b.length)) || 0);
  }
  return mismatch === 0;
}

function generateAccessCode_() {
  const raw = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  return raw.slice(0, 6) + '-' + raw.slice(6, 12) + '-' + raw.slice(12, 24);
}

function createSessionToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function sessionKey_(token) {
  return 'session_' + token;
}

function loginRateKey_(code) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, code);
  return 'login_' + Utilities.base64EncodeWebSafe(bytes).slice(0, 40);
}

function parseDateFilter_(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(text + 'T00:00:00');
  return isNaN(parsed.getTime()) ? null : parsed;
}

function coerceDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate_(date) {
  if (!date) return '';
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function toBoolean_(value) {
  if (value === true) return true;
  return ['true', 'yes', '1'].indexOf(String(value || '').trim().toLowerCase()) >= 0;
}

function safeCell_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate_(value);
  return String(value).trim();
}
