// =========================================================================
// MÓDULO DE GASTOS CON TARJETA CORPORATIVA CON IA — IVAD SRL
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

let state = {
  transactions: [],
  filters: {
    banco: '',
    moneda: '',
    estado: '',
    search: ''
  },
  detectedAiTransaction: null
};

// Tarjetas registradas conocidas
const CONOCIDOS = {
  '4589': { titular: 'José Ramón Miranda', banco: 'Banco Popular Dominicano', tipo: 'Crédito' },
  '7214': { titular: 'Myriam Laval', banco: 'Banreservas', tipo: 'Crédito' },
  '3301': { titular: 'José Ramón Miranda', banco: 'Banco BHD', tipo: 'Crédito' },
  '9012': { titular: 'Jeannette A. Mejia', banco: 'Banco Popular Dominicano', tipo: 'Débito' }
};

// Íconos según categoría / comercio
function getMerchantIcon(cat, merchant) {
  const m = (merchant || '').toLowerCase();
  const c = (cat || '').toLowerCase();
  if (c.includes('combustible') || m.includes('texaco') || m.includes('total') || m.includes('shell') || m.includes('gasolina')) return '⛽';
  if (c.includes('software') || m.includes('google') || m.includes('microsoft') || m.includes('adobe') || m.includes('aws') || m.includes('cloud')) return '💻';
  if (c.includes('alimentos') || m.includes('restaurante') || m.includes('cafe') || m.includes('burger') || m.includes('pedidosya')) return '🍽️';
  if (c.includes('mantenimiento') || m.includes('ferreteria') || m.includes('ochoa') || m.includes('bellon') || m.includes('ikea')) return '🔨';
  if (c.includes('viajes') || m.includes('hotel') || m.includes('vuelo') || m.includes('airbnb') || m.includes('uber')) return '✈️';
  if (c.includes('suministros') || m.includes('supermercado') || m.includes('nacional') || m.includes('bravo') || m.includes('sirena')) return '🛒';
  return '🏢';
}

const fmtDOP = n => new Intl.NumberFormat('es-DO', { style: 'currency', currency: 'DOP', minimumFractionDigits: 2 }).format(n || 0);
const fmtUSD = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n || 0);
const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// =========================================================================
// MOTOR DE EXTRACCIÓN Y VALIDACIÓN CON IA (PARSER INTELIGENTE)
// =========================================================================
function parseBankEmailAI(rawText) {
  if (!rawText || rawText.trim().length < 15) {
    throw new Error("El texto del correo está vacío o es muy corto.");
  }

  const text = rawText.toLowerCase();

  // Filtro Estricto: solo tarjetas
  const isCard = text.includes('tarjeta') || text.includes('card') || text.includes('tdc') || 
                 text.includes('tdd') || text.includes('visa') || text.includes('mastercard') || 
                 text.includes('pos') || text.includes('consumo') || text.includes('aprobada') ||
                 text.includes('compra por internet') || text.includes('transaccion comercial');

  const isCashOrTransfer = (text.includes('transferencia recibida') || text.includes('transferencia enviada') ||
                           text.includes('retiro en cajero') || text.includes('deposito en efectivo') ||
                           text.includes('pago en ventanilla') || text.includes('pago en efectivo')) &&
                           !text.includes('tarjeta');

  if (isCashOrTransfer || !isCard) {
    throw new Error("Transacción rechazada: El correo no corresponde a un consumo con tarjeta corporativa (parece ser una transferencia, retiro o efectivo). Este módulo registra exclusivamente compras con tarjeta.");
  }

  // Detección de Banco
  let banco = 'Banco Popular Dominicano';
  if (text.includes('reservas') || text.includes('banreservas')) {
    banco = 'Banreservas';
  } else if (text.includes('bhd') || text.includes('bhd leon')) {
    banco = 'Banco BHD';
  } else if (text.includes('scotiabank') || text.includes('scotia')) {
    banco = 'Scotiabank';
  } else if (text.includes('promerica')) {
    banco = 'Banco Promerica';
  } else if (text.includes('santa cruz')) {
    banco = 'Banco Santa Cruz';
  } else if (text.includes('qik')) {
    banco = 'Qik Banco Digital';
  }

  // Detección de Tarjeta
  let tarjeta = '0000';
  const tarjetaMatch = rawText.match(/terminada en\s*[:#*]?\s*(\d{4})/i) ||
                       rawText.match(/tarjeta\s*[:*#]?\s*[*xX\s]{2,12}(\d{4})/i) ||
                       rawText.match(/[*xX]{4}\s*(\d{4})/i) ||
                       rawText.match(/no\.\s*[*xX\s]*(\d{4})/i) ||
                       rawText.match(/(\d{4})\s*aprobada/i);
  if (tarjetaMatch) {
    tarjeta = tarjetaMatch[1];
  }

  // Detección de Moneda y Monto
  let moneda = 'DOP';
  let monto = 0;

  if (rawText.match(/US\$|USD|dólares|dolares/i)) {
    moneda = 'USD';
  }

  const montoMatch = rawText.match(/(?:RD\$|DOP|US\$|USD|\$)\s*([\d,]+\.?\d*)/i) ||
                     rawText.match(/monto[:\s]+(?:RD\$|DOP|US\$|USD|\$)?\s*([\d,]+\.?\d*)/i) ||
                     rawText.match(/por\s+(?:RD\$|DOP|US\$|USD|\$)?\s*([\d,]+\.?\d*)/i) ||
                     rawText.match(/valor[:\s]+(?:RD\$|DOP|US\$|USD|\$)?\s*([\d,]+\.?\d*)/i);

  if (montoMatch) {
    const cleanMonto = montoMatch[1].replace(/,/g, '');
    monto = parseFloat(cleanMonto) || 0;
  }

  // Detección de Comercio
  let comercio = 'Comercio Corporativo';
  const comercioMatch = rawText.match(/en[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/comercio[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/establecimiento[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/realizado en[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/lugar[:\s]+([^\n\r,.;]+)/i);

  if (comercioMatch && comercioMatch[1]) {
    comercio = comercioMatch[1].trim().replace(/^[:\-\s]+/, '').slice(0, 50);
  }

  // Detección de Autorización
  let autorizacion = 'AUT-' + Math.floor(100000 + Math.random() * 900000);
  const autMatch = rawText.match(/autorizaci[oó]n[:\s]+([A-Za-z0-9]+)/i) ||
                   rawText.match(/aprobaci[oó]n[:\s]+([A-Za-z0-9]+)/i) ||
                   rawText.match(/no\.?\s*(?:de\s*)?aprobaci[oó]n[:\s]+([A-Za-z0-9]+)/i) ||
                   rawText.match(/ref[:\s]+([A-Za-z0-9]+)/i);
  if (autMatch) {
    autorizacion = autMatch[1].trim();
  }

  // Fecha y Hora
  let fecha = new Date().toISOString().split('T')[0];
  let hora = new Date().toTimeString().slice(0, 5);

  const fechaMatch = rawText.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (fechaMatch) {
    const [, d, m, y] = fechaMatch;
    fecha = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const horaMatch = rawText.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
  if (horaMatch) {
    let [full, hh, mm, ap] = horaMatch;
    hh = parseInt(hh, 10);
    if (ap && ap.toLowerCase() === 'pm' && hh < 12) hh += 12;
    if (ap && ap.toLowerCase() === 'am' && hh === 12) hh = 0;
    hora = `${String(hh).padStart(2, '0')}:${mm}`;
  }

  // Categoría
  const cLower = comercio.toLowerCase();
  let categoria = 'Servicios Generales';
  if (cLower.match(/texaco|shell|total|isla|gasolina|combustible|petro|esso|sunix/)) {
    categoria = 'Combustible y Transporte';
  } else if (cLower.match(/google|microsoft|adobe|aws|amazon web|zoom|openai|apple|cloudflare|vercel/)) {
    categoria = 'Software y Suscripciones';
  } else if (cLower.match(/restaurant|restaurante|cafe|café|burger|pizza|pedidosya|uber eats|bistro|comida/)) {
    categoria = 'Alimentos y Representación';
  } else if (cLower.match(/ferreteria|ochoa|bellon|ikea|office|papeleria|repuesto|taller|mantenimiento/)) {
    categoria = 'Mantenimiento y Reparaciones';
  } else if (cLower.match(/hotel|vuelo|aeropuerto|copa|iberia|jetblue|airbnb|uber|hospedaje/)) {
    categoria = 'Viajes y Hospedaje';
  } else if (cLower.match(/supermercado|nacional|bravo|sirena|jumbo|policlinica|farmacia/)) {
    categoria = 'Suministros y Compras';
  }

  // Titular
  let titular = 'Dirección / Colaborador IVAD';
  if (CONOCIDOS[tarjeta]) {
    titular = CONOCIDOS[tarjeta].titular;
    if (CONOCIDOS[tarjeta].banco) banco = CONOCIDOS[tarjeta].banco;
  }

  return {
    banco,
    tarjeta_ultimos4: tarjeta,
    tipo_tarjeta: 'Crédito',
    titular,
    comercio: comercio.toUpperCase(),
    monto,
    moneda,
    categoria,
    fecha,
    hora,
    num_autorizacion: autorizacion,
    estado_conciliacion: 'Pendiente',
    texto_original: rawText.slice(0, 500)
  };
}

// =========================================================================
// CARGA Y PERSISTENCIA DE DATOS
// =========================================================================
async function fetchTransactions() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('gastos_tarjeta')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      state.transactions = data || [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
    } catch (err) {
      console.warn("Fallo al conectar con Supabase. Usando caché local.", err);
      loadCache();
    }
  } else {
    loadCache();
  }

  render();
}

function loadCache() {
  try {
    state.transactions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    state.transactions = [];
  }
}

function saveCache() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
}

// =========================================================================
// RENDERIZADO Y MÉTRICAS
// =========================================================================
function render() {
  renderKPIs();
  renderVirtualCards();
  renderTable();
}

function getFilteredTransactions() {
  return state.transactions.filter(t => {
    if (state.filters.banco && t.banco !== state.filters.banco) return false;
    if (state.filters.moneda && t.moneda !== state.filters.moneda) return false;
    if (state.filters.estado && t.estado_conciliacion !== state.filters.estado) return false;

    if (state.filters.search) {
      const q = state.filters.search.toLowerCase();
      const match = (t.comercio && t.comercio.toLowerCase().includes(q)) ||
                    (t.titular && t.titular.toLowerCase().includes(q)) ||
                    (t.num_autorizacion && t.num_autorizacion.toLowerCase().includes(q)) ||
                    (t.ncf && t.ncf.toLowerCase().includes(q)) ||
                    (t.tarjeta_ultimos4 && t.tarjeta_ultimos4.includes(q));
      if (!match) return false;
    }

    return true;
  });
}

function renderKPIs() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthTransactions = state.transactions.filter(t => t.fecha.startsWith(currentMonth));

  let totalDOP = 0;
  let totalUSD = 0;
  let pendientes = 0;
  let conciliados = 0;

  monthTransactions.forEach(t => {
    const val = Number(t.monto) || 0;
    if (t.moneda === 'USD') {
      totalUSD += val;
    } else {
      totalDOP += val;
    }

    if (t.estado_conciliacion === 'Conciliado') {
      conciliados++;
    } else {
      pendientes++;
    }
  });

  const elDOP = document.getElementById('kpiTotalDOP');
  const elUSD = document.getElementById('kpiTotalUSD');
  const elCount = document.getElementById('kpiTransacciones');
  const elPendientes = document.getElementById('kpiPendientes');

  if (elDOP) elDOP.textContent = fmtDOP(totalDOP);
  if (elUSD) elUSD.textContent = fmtUSD(totalUSD);
  if (elCount) elCount.textContent = monthTransactions.length;
  if (elPendientes) elPendientes.textContent = `${pendientes} facturas`;
}

function renderVirtualCards() {
  const wrap = document.getElementById('cardsSlider');
  if (!wrap) return;

  const cardMap = {};
  state.transactions.forEach(t => {
    const digits = t.tarjeta_ultimos4 || '0000';
    if (!cardMap[digits]) {
      cardMap[digits] = {
        tarjeta: digits,
        banco: t.banco || 'Banco Corporativo',
        titular: t.titular || (CONOCIDOS[digits] ? CONOCIDOS[digits].titular : 'Colaborador IVAD'),
        tipo: t.tipo_tarjeta || 'Crédito',
        totalDOP: 0,
        totalUSD: 0,
        count: 0
      };
    }
    const val = Number(t.monto) || 0;
    if (t.moneda === 'USD') cardMap[digits].totalUSD += val;
    else cardMap[digits].totalDOP += val;
    cardMap[digits].count++;
  });

  const cardsList = Object.values(cardMap);
  if (cardsList.length === 0) {
    wrap.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 30px; text-align: center; color: var(--text-muted); background: white; border-radius: 16px; border: 1px dashed var(--border);">
        No hay tarjetas con consumos registrados en este período.
      </div>
    `;
    return;
  }

  wrap.innerHTML = cardsList.map(c => {
    let metalClass = 'metal-popular';
    const bLower = c.banco.toLowerCase();
    if (bLower.includes('reservas')) metalClass = 'metal-reservas';
    else if (bLower.includes('bhd')) metalClass = 'metal-bhd';
    else if (bLower.includes('scotia')) metalClass = 'metal-scotia';

    let spendText = fmtDOP(c.totalDOP);
    if (c.totalUSD > 0) {
      spendText += ` + ${fmtUSD(c.totalUSD)}`;
    }

    return `
      <div class="metal-card ${metalClass}">
        <div class="card-top">
          <div class="card-bank-name">
            <span>🏛️</span>
            <span>${escapeHtml(c.banco)}</span>
          </div>
          <svg class="contactless-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10"></path>
            <path d="M8 5a10.3 10.3 0 0 1 3 7 10.3 10.3 0 0 1-3 7"></path>
            <path d="M4 8a5.3 5.3 0 0 1 2 4 5.3 5.3 0 0 1-2 4"></path>
          </svg>
        </div>

        <div class="card-chip-row">
          <div class="emv-chip"></div>
          <div class="card-digits">•••• ${c.tarjeta}</div>
        </div>

        <div class="card-bottom">
          <div>
            <div class="card-holder-title">Titular Asignado</div>
            <div class="card-holder-name">${escapeHtml(c.titular)}</div>
          </div>
          <div class="card-balance-block">
            <div class="card-balance-label">Gasto Acumulado</div>
            <div class="card-balance-amt">${spendText}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTable() {
  const tbody = document.getElementById('transactionsTableBody');
  const countSpan = document.getElementById('tableRowCount');
  if (!tbody) return;

  const list = getFilteredTransactions();
  if (countSpan) countSpan.textContent = `${list.length} transacciones registradas`;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 48px; color: var(--text-muted);">
          No se encontraron consumos con tarjeta con los filtros seleccionados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(t => {
    let badgeClass = 'badge-pendiente';
    let dotColor = '#d97706';
    if (t.estado_conciliacion === 'Conciliado') {
      badgeClass = 'badge-conciliado';
      dotColor = '#10b981';
    } else if (t.estado_conciliacion === 'Factura Adjunta') {
      badgeClass = 'badge-factura';
      dotColor = '#2563eb';
    }

    const formattedMonto = t.moneda === 'USD' ? fmtUSD(t.monto) : fmtDOP(t.monto);
    const icon = getMerchantIcon(t.categoria, t.comercio);

    return `
      <tr>
        <td>
          <div style="font-weight: 700; color: var(--navy-dark);">${t.fecha}</div>
          <div style="font-size: 11.5px; color: var(--text-muted);">${t.hora || '—'}</div>
        </td>
        <td>
          <span class="badge-pill badge-card-tag">💳 •••• ${t.tarjeta_ultimos4}</span>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${escapeHtml(t.banco)}</div>
        </td>
        <td>
          <div class="merchant-cell">
            <div class="merchant-avatar">${icon}</div>
            <div>
              <div class="merchant-name">${escapeHtml(t.comercio)}</div>
              <div class="merchant-sub">Titular: ${escapeHtml(t.titular || '—')}</div>
            </div>
          </div>
        </td>
        <td>
          <span style="font-size: 12px; font-weight: 600; color: #1e3a8a; background: #f0f7ff; padding: 4px 10px; border-radius: 6px; border: 1px solid #dbeafe;">
            ${escapeHtml(t.categoria)}
          </span>
        </td>
        <td>
          <span class="amount-text">${formattedMonto}</span>
        </td>
        <td>
          <span class="badge-pill ${badgeClass}">
            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${dotColor};"></span>
            ${escapeHtml(t.estado_conciliacion)}
          </span>
          ${t.ncf ? `<div style="font-size: 10px; color: var(--text-muted); font-family: monospace; margin-top: 4px;">NCF: ${escapeHtml(t.ncf)}</div>` : ''}
        </td>
        <td>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-icon" onclick="window.cambiarEstado('${t.id}')" title="Marcar como Conciliado / Asignar NCF">
              ✓
            </button>
            <button class="btn btn-secondary btn-icon" onclick="window.eliminarGasto('${t.id}')" title="Eliminar registro" style="color: var(--danger);">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// =========================================================================
// ACCIONES Y NOTIFICACIONES
// =========================================================================
function showToast(msg, isError = false) {
  const toast = document.createElement('div');
  toast.className = 'toast-popup';
  if (isError) toast.style.borderLeftColor = '#ef4444';
  toast.innerHTML = `<span>${isError ? '⚠️' : '✨'}</span> <span>${escapeHtml(msg)}</span>`;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

window.cambiarEstado = async function(id) {
  const item = state.transactions.find(t => t.id === id);
  if (!item) return;

  const nuevoEstado = item.estado_conciliacion === 'Conciliado' ? 'Pendiente' : 'Conciliado';
  let ncf = item.ncf;
  if (nuevoEstado === 'Conciliado' && !ncf) {
    const promptNcf = prompt("Ingrese el NCF o Comprobante Fiscal asociado (opcional):", "B0100000000");
    if (promptNcf) ncf = promptNcf.trim();
  }

  if (supabaseClient) {
    const { error } = await supabaseClient
      .from('gastos_tarjeta')
      .update({ estado_conciliacion: nuevoEstado, ncf: ncf })
      .eq('id', id);

    if (error) {
      showToast("Error actualizando estado en base de datos", true);
      return;
    }
  }

  item.estado_conciliacion = nuevoEstado;
  item.ncf = ncf;
  saveCache();
  render();
  showToast(`Transacción marcada como ${nuevoEstado}`);
};

window.eliminarGasto = async function(id) {
  if (!confirm("¿Está seguro de que desea eliminar este registro de gasto con tarjeta?")) return;

  if (supabaseClient) {
    const { error } = await supabaseClient
      .from('gastos_tarjeta')
      .delete()
      .eq('id', id);

    if (error) {
      showToast("Error eliminando registro en base de datos", true);
      return;
    }
  }

  state.transactions = state.transactions.filter(t => t.id !== id);
  saveCache();
  render();
  showToast("Registro eliminado correctamente");
};

// =========================================================================
// INICIALIZACIÓN
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  fetchTransactions();

  const modalAi = document.getElementById('modalAi');
  const modalManual = document.getElementById('modalManual');
  const modalInfo = document.getElementById('modalInfo');

  document.getElementById('btnOpenAiModal')?.addEventListener('click', () => {
    state.detectedAiTransaction = null;
    document.getElementById('aiRawText').value = '';
    document.getElementById('aiResultBox').style.display = 'none';
    document.getElementById('btnConfirmAi').style.display = 'none';
    modalAi.hidden = false;
  });

  document.getElementById('btnOpenManualModal')?.addEventListener('click', () => {
    document.getElementById('manualForm').reset();
    document.getElementById('manualFecha').value = new Date().toISOString().split('T')[0];
    modalManual.hidden = false;
  });

  document.getElementById('btnOpenInfoModal')?.addEventListener('click', () => {
    modalInfo.hidden = false;
  });

  document.querySelectorAll('.modal-close-x, .btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      modalAi.hidden = true;
      modalManual.hidden = true;
      modalInfo.hidden = true;
    });
  });

  // Procesamiento con IA
  document.getElementById('btnProcessAi')?.addEventListener('click', () => {
    const raw = document.getElementById('aiRawText').value;
    try {
      const parsed = parseBankEmailAI(raw);
      state.detectedAiTransaction = parsed;

      document.getElementById('previewBanco').textContent = parsed.banco;
      document.getElementById('previewTarjeta').textContent = `•••• ${parsed.tarjeta_ultimos4}`;
      document.getElementById('previewComercio').textContent = parsed.comercio;
      document.getElementById('previewMonto').textContent = parsed.moneda === 'USD' ? fmtUSD(parsed.monto) : fmtDOP(parsed.monto);
      document.getElementById('previewCategoria').textContent = parsed.categoria;
      document.getElementById('previewAut').textContent = parsed.num_autorizacion;
      document.getElementById('previewTitular').textContent = parsed.titular;
      document.getElementById('previewFechaHora').textContent = `${parsed.fecha} ${parsed.hora}`;

      document.getElementById('aiResultBox').style.display = 'block';
      document.getElementById('btnConfirmAi').style.display = 'inline-flex';
    } catch (err) {
      alert("❌ " + err.message);
    }
  });

  // Confirmar y Guardar
  document.getElementById('btnConfirmAi')?.addEventListener('click', async () => {
    if (!state.detectedAiTransaction) return;

    const dataToSave = { ...state.detectedAiTransaction };
    let savedRow = null;

    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('gastos_tarjeta')
        .insert([dataToSave])
        .select();

      if (error) {
        showToast("Error guardando en Supabase: " + error.message, true);
        return;
      }
      savedRow = data && data[0] ? data[0] : { id: 'local_' + Date.now(), ...dataToSave };
    } else {
      savedRow = { id: 'local_' + Date.now(), ...dataToSave };
    }

    state.transactions.unshift(savedRow);
    saveCache();
    render();

    modalAi.hidden = true;
    showToast("¡Gasto con tarjeta registrado con éxito!");
  });

  // Registro Manual
  document.getElementById('manualForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const dataToSave = {
      banco: document.getElementById('manualBanco').value,
      tarjeta_ultimos4: document.getElementById('manualTarjeta').value.slice(-4),
      tipo_tarjeta: document.getElementById('manualTipo').value,
      titular: document.getElementById('manualTitular').value,
      comercio: document.getElementById('manualComercio').value.toUpperCase(),
      monto: parseFloat(document.getElementById('manualMonto').value) || 0,
      moneda: document.getElementById('manualMoneda').value,
      categoria: document.getElementById('manualCategoria').value,
      fecha: document.getElementById('manualFecha').value,
      hora: document.getElementById('manualHora').value || new Date().toTimeString().slice(0, 5),
      num_autorizacion: document.getElementById('manualAut').value || 'AUT-' + Math.floor(100000 + Math.random() * 900000),
      ncf: document.getElementById('manualNcf').value || null,
      notas: document.getElementById('manualNotas').value || null,
      estado_conciliacion: document.getElementById('manualEstado').value
    };

    let savedRow = null;
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from('gastos_tarjeta')
        .insert([dataToSave])
        .select();

      if (error) {
        showToast("Error guardando en base de datos: " + error.message, true);
        return;
      }
      savedRow = data && data[0] ? data[0] : { id: 'local_' + Date.now(), ...dataToSave };
    } else {
      savedRow = { id: 'local_' + Date.now(), ...dataToSave };
    }

    state.transactions.unshift(savedRow);
    saveCache();
    render();

    modalManual.hidden = true;
    showToast("Gasto con tarjeta guardado");
  });

  // Filtros
  document.getElementById('filterBanco')?.addEventListener('change', e => {
    state.filters.banco = e.target.value;
    render();
  });
  document.getElementById('filterMoneda')?.addEventListener('change', e => {
    state.filters.moneda = e.target.value;
    render();
  });
  document.getElementById('filterEstado')?.addEventListener('change', e => {
    state.filters.estado = e.target.value;
    render();
  });
  document.getElementById('searchInput')?.addEventListener('input', e => {
    state.filters.search = e.target.value;
    render();
  });

  document.getElementById('btnSync')?.addEventListener('click', () => {
    fetchTransactions();
    showToast("Datos sincronizados con Supabase");
  });
});
