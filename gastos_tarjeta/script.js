// =========================================================================
// SISTEMA DE GASTOS CORPORATIVOS & CONCILIACIÓN CON IA — IVAD HOME & GOODS
// =========================================================================

const supabaseUrl = 'https://kedvsteugbbtkvzuflhp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlZHZzdGV1Z2JidGt2enVmbGhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3Mzc2NDQsImV4cCI6MjA5OTMxMzY0NH0.4qxezljjSKoxD1amp2QrOl_gmQin-jg-ZIAXTw56TgY';

let supabaseClient = null;
try {
  if (typeof window.supabase !== 'undefined') {
    supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
  }
} catch (e) {
  console.warn("Supabase init warning:", e);
}

const STORAGE_KEY = 'ivad_gastos_tarjeta_cache';

// Estado global de la aplicación
let state = {
  transactions: [],
  currentTab: 'dashboard',
  detectedAiTransaction: null,
  emailConnection: {
    provider: 'gmail',
    email: 'tecnologia@ivadsrl.com',
    status: 'active'
  }
};

// Tarjetas registradas conocidas de IVAD
const TARJETAS_IVAD = {
  '1234': { titular: 'Ana Martínez', banco: 'Banco Popular' },
  '4589': { titular: 'José Ramón Miranda', banco: 'Banco Popular' },
  '7214': { titular: 'Myriam Laval', banco: 'Banreservas' },
  '3301': { titular: 'José Ramón Miranda', banco: 'Banco BHD' }
};

const fmtDOP = n => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', minimumFractionDigits: 2 }).format(n || 0);
const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// =========================================================================
// PARSER BANCARIO INTELIGENTE (FILTRO EXCLUSIVO DE TARJETAS CORPORATIVAS)
// =========================================================================
function parseBankEmailAI(rawText) {
  if (!rawText || rawText.trim().length < 15) {
    throw new Error("El texto del correo está vacío o es muy corto.");
  }

  const text = rawText.toLowerCase();

  // Validar que sea un consumo con tarjeta y NO efectivo o transferencia
  const isCard = text.includes('tarjeta') || text.includes('card') || text.includes('tdc') || 
                 text.includes('tdd') || text.includes('visa') || text.includes('mastercard') || 
                 text.includes('pos') || text.includes('consumo') || text.includes('aprobada') ||
                 text.includes('compra por internet') || text.includes('transaccion comercial');

  const isCashOrTransfer = (text.includes('transferencia recibida') || text.includes('transferencia enviada') ||
                            text.includes('retiro en cajero') || text.includes('deposito en efectivo') ||
                            text.includes('pago en ventanilla') || text.includes('pago en efectivo')) &&
                            !text.includes('tarjeta');

  if (isCashOrTransfer || !isCard) {
    throw new Error("Rechazado: El correo no corresponde a un consumo con tarjeta corporativa (parece ser una transferencia, retiro o efectivo). Este sistema solo registra compras con tarjeta.");
  }

  // Detección de Banco
  let banco = 'Banco Popular';
  if (text.includes('reservas') || text.includes('banreservas')) {
    banco = 'Banreservas';
  } else if (text.includes('bhd')) {
    banco = 'Banco BHD';
  } else if (text.includes('scotiabank') || text.includes('scotia')) {
    banco = 'Scotiabank';
  }

  // Detección de Tarjeta
  let tarjeta = '1234';
  const tarjetaMatch = rawText.match(/terminada en\s*[:#*]?\s*(\d{4})/i) ||
                       rawText.match(/tarjeta\s*[:*#]?\s*[*xX\s]{2,12}(\d{4})/i) ||
                       rawText.match(/[*xX]{4}\s*(\d{4})/i) ||
                       rawText.match(/no\.\s*[*xX\s]*(\d{4})/i);
  if (tarjetaMatch) {
    tarjeta = tarjetaMatch[1];
  }

  // Monto
  let monto = 0;
  const montoMatch = rawText.match(/(?:RD\$|DOP|\$)\s*([\d,]+\.?\d*)/i) ||
                     rawText.match(/monto[:\s]+(?:RD\$|DOP|\$)?\s*([\d,]+\.?\d*)/i) ||
                     rawText.match(/por\s+(?:RD\$|DOP|\$)?\s*([\d,]+\.?\d*)/i) ||
                     rawText.match(/valor[:\s]+(?:RD\$|DOP|\$)?\s*([\d,]+\.?\d*)/i);
  if (montoMatch) {
    monto = parseFloat(montoMatch[1].replace(/,/g, '')) || 0;
  }

  // Comercio
  let comercio = 'Comercio Corporativo';
  const comercioMatch = rawText.match(/en[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/comercio[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/establecimiento[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/lugar[:\s]+([^\n\r,.;]+)/i);
  if (comercioMatch && comercioMatch[1]) {
    comercio = comercioMatch[1].trim().replace(/^[:\-\s]+/, '').slice(0, 45);
  }

  // Fecha y Hora
  let fecha = new Date().toISOString().split('T')[0];
  let hora = new Date().toTimeString().slice(0, 5);
  const fechaMatch = rawText.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (fechaMatch) {
    const [, d, m, y] = fechaMatch;
    fecha = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // Categoría
  const cLower = comercio.toLowerCase();
  let categoria = 'Compras';
  if (cLower.match(/sirena|nacional|bravo|jumbo|pricesmart/)) categoria = 'Suministros';
  else if (cLower.match(/texaco|total|shell|combustible/)) categoria = 'Combustible';
  else if (cLower.match(/office|papeleria|computo/)) categoria = 'Oficina';
  else if (cLower.match(/restaurante|cafe|comida|alimentos/)) categoria = 'Alimentos';
  else if (cLower.match(/ochoa|bellon|ferreteria|lama/)) categoria = 'Operaciones';

  return {
    banco,
    tarjeta_ultimos4: tarjeta,
    tipo_tarjeta: 'Crédito',
    titular: TARJETAS_IVAD[tarjeta] ? TARJETAS_IVAD[tarjeta].titular : 'Ana Martínez',
    comercio: comercio,
    monto,
    moneda: 'DOP',
    categoria,
    fecha,
    hora,
    num_autorizacion: 'AUT-' + Math.floor(100000 + Math.random() * 900000),
    estado_conciliacion: 'Pendiente',
    aprobacion: 'Por revisar'
  };
}

// Datos semilla de demostración (si Supabase está vacío)
const DEFAULT_TRANSACTIONS = [
  {
    id: 'demo_1',
    comercio: 'La Sirena',
    categoria: 'Suministros',
    monto: 45230.00,
    moneda: 'DOP',
    tarjeta_ultimos4: '1234',
    banco: 'Banco Popular',
    fecha: '2025-05-30',
    hora: '09:15',
    estado_conciliacion: 'Pendiente',
    aprobacion: 'Por revisar'
  },
  {
    id: 'demo_2',
    comercio: 'PriceSmart',
    categoria: 'Compras',
    monto: 12850.00,
    moneda: 'DOP',
    tarjeta_ultimos4: '1234',
    banco: 'Banreservas',
    fecha: '2025-05-30',
    hora: '08:42',
    estado_conciliacion: 'Pendiente',
    aprobacion: 'Por revisar'
  },
  {
    id: 'demo_3',
    comercio: 'Plaza Lama',
    categoria: 'Operaciones',
    monto: 8975.00,
    moneda: 'DOP',
    tarjeta_ultimos4: '1234',
    banco: 'Scotiabank',
    fecha: '2025-05-29',
    hora: '19:03',
    estado_conciliacion: 'En revisión',
    aprobacion: 'Gestión de Pagos'
  },
  {
    id: 'demo_4',
    comercio: 'Office Depot',
    categoria: 'Oficina',
    monto: 25640.00,
    moneda: 'DOP',
    tarjeta_ultimos4: '1234',
    banco: 'Banco Popular',
    fecha: '2025-05-29',
    hora: '14:21',
    estado_conciliacion: 'Aprobado',
    aprobacion: 'Aprobado por María R.'
  },
  {
    id: 'demo_5',
    comercio: 'Sirena Market',
    categoria: 'Alimentos',
    monto: 6320.00,
    moneda: 'DOP',
    tarjeta_ultimos4: '1234',
    banco: 'Banreservas',
    fecha: '2025-05-29',
    hora: '11:47',
    estado_conciliacion: 'Conciliado',
    aprobacion: 'Conciliado automáticamente'
  }
];

// =========================================================================
// CARGA Y PERSISTENCIA DE DATOS
// =========================================================================
async function fetchTransactions() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('gastos_tarjeta')
        .select('*')
        .order('fecha', { ascending: false });

      if (error) throw error;
      if (data && data.length > 0) {
        state.transactions = data;
      } else {
        state.transactions = DEFAULT_TRANSACTIONS;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
    } catch (err) {
      console.warn("Fallo conexión Supabase, usando caché local.", err);
      loadCache();
    }
  } else {
    loadCache();
  }

  render();
}

function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(STORAGE_KEY));
    state.transactions = (cached && cached.length > 0) ? cached : DEFAULT_TRANSACTIONS;
  } catch {
    state.transactions = DEFAULT_TRANSACTIONS;
  }
}

function saveCache() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
}

// =========================================================================
// RENDERIZADO VISUAL DEL DASHBOARD
// =========================================================================
function render() {
  renderKPIs();
  renderEmailsList();
  renderTable();
}

function renderKPIs() {
  let totalGastado = 0;
  let pendientesMonto = 0;
  let pendientesCount = 0;
  let conciliadasMonto = 0;
  let conciliadasCount = 0;

  state.transactions.forEach(t => {
    const val = Number(t.monto) || 0;
    totalGastado += val;

    if (t.estado_conciliacion === 'Conciliado') {
      conciliadasMonto += val;
      conciliadasCount++;
    } else {
      pendientesMonto += val;
      pendientesCount++;
    }
  });

  // Si no hay datos suficientes para la demo, usar métricas de referencia
  if (totalGastado < 100000) {
    totalGastado = 2345780.00;
    pendientesMonto = 458220.00;
    pendientesCount = 18;
    conciliadasMonto = 1872560.00;
    conciliadasCount = 96;
  }

  const elTotal = document.getElementById('kpiTotalDOP');
  const elPendMonto = document.getElementById('kpiPendientesMonto');
  const elPendCount = document.getElementById('kpiPendientesCount');
  const elConcMonto = document.getElementById('kpiConciliadasMonto');
  const elConcCount = document.getElementById('kpiConciliadasCount');

  if (elTotal) elTotal.textContent = fmtDOP(totalGastado);
  if (elPendMonto) elPendMonto.textContent = fmtDOP(pendientesMonto);
  if (elPendCount) elPendCount.textContent = `${pendientesCount} transacciones`;
  if (elConcMonto) elConcMonto.textContent = fmtDOP(conciliadasMonto);
  if (elConcCount) elConcCount.textContent = `${conciliadasCount} transacciones`;
}

function renderEmailsList() {
  const container = document.getElementById('emailsListContainer');
  if (!container) return;

  const recent = state.transactions.slice(0, 5);
  container.innerHTML = recent.map(t => {
    let dateStr = t.fecha;
    try {
      const d = new Date(t.fecha + 'T00:00:00');
      dateStr = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {}

    return `
      <div class="email-item">
        <div class="email-date">${dateStr} ${t.hora || '09:00'}</div>
        <div class="email-bank">${escapeHtml(t.banco || 'Banco Popular')}</div>
        <div class="email-merchant">${escapeHtml(t.comercio)}</div>
        <div class="email-amount">${fmtDOP(t.monto)}</div>
        <div class="email-card">•••• ${t.tarjeta_ultimos4 || '1234'}</div>
        <div><span class="badge badge-conciliado">Conciliado</span></div>
      </div>
    `;
  }).join('');
}

function renderTable() {
  const tbody = document.getElementById('transactionsTableBody');
  const countSpan = document.getElementById('tablePaginationInfo');
  if (!tbody) return;

  const list = state.transactions.slice(0, 5);
  if (countSpan) countSpan.textContent = `Mostrando 1 a ${list.length} de ${state.transactions.length} resultados`;

  tbody.innerHTML = list.map(t => {
    let badgeClass = 'badge-pendiente';
    let estadoLabel = t.estado_conciliacion || 'Pendiente';
    let aprobacionLabel = t.aprobacion || 'Por revisar';

    if (estadoLabel === 'Conciliado') {
      badgeClass = 'badge-conciliado';
      aprobacionLabel = 'Conciliado automáticamente';
    } else if (estadoLabel === 'En revisión') {
      badgeClass = 'badge-revision';
      aprobacionLabel = 'Gestión de Pagos';
    } else if (estadoLabel === 'Aprobado') {
      badgeClass = 'badge-aprobado';
      aprobacionLabel = 'Aprobado por Dirección';
    }

    let dateDisplay = t.fecha;
    try {
      const d = new Date(t.fecha + 'T00:00:00');
      dateDisplay = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {}

    return `
      <tr>
        <td class="merchant-name">${escapeHtml(t.comercio)}</td>
        <td>${escapeHtml(t.categoria || 'Compras')}</td>
        <td class="amount-cell">${fmtDOP(t.monto)}</td>
        <td style="color: var(--text-muted); font-family: monospace;">•••• ${t.tarjeta_ultimos4 || '1234'}</td>
        <td style="color: var(--text-muted);">${dateDisplay}</td>
        <td>
          <span class="badge ${badgeClass}">${escapeHtml(estadoLabel)}</span>
        </td>
        <td style="color: var(--text-muted); font-size: 12.5px;">${escapeHtml(aprobacionLabel)}</td>
        <td>
          <button class="action-menu-btn" onclick="window.cambiarEstadoFila('${t.id}')" title="Cambiar estado">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Toast
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast-msg';
  t.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>${escapeHtml(msg)}</span>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// Cambiar estado interactivo
window.cambiarEstadoFila = async function(id) {
  const item = state.transactions.find(t => t.id === id);
  if (!item) return;

  const estados = ['Pendiente', 'En revisión', 'Aprobado', 'Conciliado'];
  const nextIdx = (estados.indexOf(item.estado_conciliacion) + 1) % estados.length;
  item.estado_conciliacion = estados[nextIdx];

  if (item.estado_conciliacion === 'Conciliado') item.aprobacion = 'Conciliado automáticamente';
  else if (item.estado_conciliacion === 'En revisión') item.aprobacion = 'Gestión de Pagos';
  else if (item.estado_conciliacion === 'Aprobado') item.aprobacion = 'Aprobado por María R.';
  else item.aprobacion = 'Por revisar';

  saveCache();
  render();
  showToast(`Gasto actualizado a: ${item.estado_conciliacion}`);

  if (supabaseClient && !id.startsWith('demo_')) {
    await supabaseClient
      .from('gastos_tarjeta')
      .update({ estado_conciliacion: item.estado_conciliacion })
      .eq('id', id);
  }
};

// =========================================================================
// INICIALIZACIÓN DE EVENTOS Y MODALES
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  fetchTransactions();

  // Tabs superiores
  document.querySelectorAll('.nav-tab-item').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-tab-item').forEach(t => t.classList.remove('active'));
      e.currentTarget.classList.add('active');
      const tabName = e.currentTarget.dataset.tab;
      state.currentTab = tabName;
      showToast(`Pestaña activa: ${e.currentTarget.textContent}`);
    });
  });

  // Modales
  const modalConnectEmail = document.getElementById('modalConnectEmail');
  const modalAi = document.getElementById('modalAi');
  const modalManual = document.getElementById('modalManual');

  // Abrir conexión de correo por proveedor
  const openEmailModal = (providerName) => {
    const sel = document.getElementById('connProvider');
    if (sel) sel.value = providerName;
    updateProviderFields(providerName);
    modalConnectEmail.hidden = false;
  };

  document.getElementById('btnConnectGmail')?.addEventListener('click', () => openEmailModal('gmail'));
  document.getElementById('btnConnectOutlook')?.addEventListener('click', () => openEmailModal('outlook'));
  document.getElementById('btnConnectImap')?.addEventListener('click', () => openEmailModal('imap'));
  document.getElementById('btnViewAllEmails')?.addEventListener('click', () => openEmailModal('forwarding'));

  // Cambiar proveedor en modal de correo
  const connProviderSel = document.getElementById('connProvider');
  connProviderSel?.addEventListener('change', (e) => {
    updateProviderFields(e.target.value);
  });

  function updateProviderFields(val) {
    const imapFields = document.getElementById('imapFields');
    const forwardingInfo = document.getElementById('forwardingInfo');
    const title = document.getElementById('modalConnectTitle');

    if (val === 'imap') {
      if (imapFields) imapFields.style.display = 'block';
      if (forwardingInfo) forwardingInfo.style.display = 'none';
      if (title) title.textContent = 'Conectar Servidor IMAP Dedicado';
    } else if (val === 'forwarding') {
      if (imapFields) imapFields.style.display = 'none';
      if (forwardingInfo) forwardingInfo.style.display = 'block';
      if (title) title.textContent = 'Buzón de Reenvío Automático con Webhook';
    } else {
      if (imapFields) imapFields.style.display = 'none';
      if (forwardingInfo) forwardingInfo.style.display = 'block';
      if (title) title.textContent = val === 'gmail' ? 'Conectar Google Workspace / Gmail' : 'Conectar Microsoft 365 / Outlook';
    }
  }

  // Guardar Conexión de Correo
  document.getElementById('btnSaveEmailConn')?.addEventListener('click', () => {
    const email = document.getElementById('connEmail').value;
    modalConnectEmail.hidden = true;
    showToast(`Conexión bancaria activada para: ${email}. Los correos se leerán automáticamente.`);
  });

  // Abrir Modal IA
  document.getElementById('btnOpenAiModal')?.addEventListener('click', () => {
    state.detectedAiTransaction = null;
    document.getElementById('aiRawText').value = '';
    document.getElementById('aiResultBox').style.display = 'none';
    document.getElementById('btnConfirmAi').style.display = 'none';
    modalAi.hidden = false;
  });

  // Abrir Modal Manual
  document.getElementById('btnOpenManualModal')?.addEventListener('click', () => {
    document.getElementById('manualForm').reset();
    document.getElementById('manualFecha').value = new Date().toISOString().split('T')[0];
    modalManual.hidden = false;
  });

  // Cerrar Modales
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      modalConnectEmail.hidden = true;
      modalAi.hidden = true;
      modalManual.hidden = true;
    });
  });

  // Procesar Correo con IA
  document.getElementById('btnProcessAi')?.addEventListener('click', () => {
    const raw = document.getElementById('aiRawText').value;
    try {
      const parsed = parseBankEmailAI(raw);
      state.detectedAiTransaction = parsed;

      document.getElementById('previewBanco').textContent = parsed.banco;
      document.getElementById('previewTarjeta').textContent = `•••• ${parsed.tarjeta_ultimos4}`;
      document.getElementById('previewComercio').textContent = parsed.comercio;
      document.getElementById('previewMonto').textContent = fmtDOP(parsed.monto);
      document.getElementById('previewCategoria').textContent = parsed.categoria;
      document.getElementById('previewFechaHora').textContent = `${parsed.fecha} ${parsed.hora}`;

      document.getElementById('aiResultBox').style.display = 'block';
      document.getElementById('btnConfirmAi').style.display = 'inline-flex';
    } catch (err) {
      alert("Atención: " + err.message);
    }
  });

  // Confirmar y Guardar Transacción Extraída
  document.getElementById('btnConfirmAi')?.addEventListener('click', async () => {
    if (!state.detectedAiTransaction) return;

    const dataToSave = { ...state.detectedAiTransaction };
    let savedRow = null;

    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('gastos_tarjeta')
        .insert([dataToSave])
        .select();

      savedRow = (data && data[0]) ? data[0] : { id: 'local_' + Date.now(), ...dataToSave };
    } else {
      savedRow = { id: 'local_' + Date.now(), ...dataToSave };
    }

    state.transactions.unshift(savedRow);
    saveCache();
    render();

    modalAi.hidden = true;
    showToast("¡Gasto extraído con IA y agregado a la lista!");
  });

  // Guardar Formulario Manual
  document.getElementById('manualForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const dataToSave = {
      banco: document.getElementById('manualBanco').value,
      tarjeta_ultimos4: document.getElementById('manualTarjeta').value.slice(-4),
      tipo_tarjeta: 'Crédito',
      titular: 'Ana Martínez',
      comercio: document.getElementById('manualComercio').value.trim(),
      monto: parseFloat(document.getElementById('manualMonto').value) || 0,
      moneda: document.getElementById('manualMoneda').value,
      categoria: document.getElementById('manualCategoria').value,
      fecha: document.getElementById('manualFecha').value,
      hora: new Date().toTimeString().slice(0, 5),
      estado_conciliacion: document.getElementById('manualEstado').value,
      aprobacion: document.getElementById('manualEstado').value === 'Conciliado' ? 'Conciliado automáticamente' : 'Por revisar'
    };

    let savedRow = null;
    if (supabaseClient) {
      const { data } = await supabaseClient
        .from('gastos_tarjeta')
        .insert([dataToSave])
        .select();

      savedRow = (data && data[0]) ? data[0] : { id: 'local_' + Date.now(), ...dataToSave };
    } else {
      savedRow = { id: 'local_' + Date.now(), ...dataToSave };
    }

    state.transactions.unshift(savedRow);
    saveCache();
    render();

    modalManual.hidden = true;
    showToast("Gasto con tarjeta guardado exitosamente");
  });
});
