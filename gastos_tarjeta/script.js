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

// Estado global de la aplicación
let state = {
  transactions: [],
  filters: {
    banco: '',
    tarjeta: '',
    mes: '',
    moneda: '',
    estado: '',
    search: ''
  },
  detectedAiTransaction: null
};

// Tarjetas registradas conocidas de la empresa
const CONOCIDOS = {
  '4589': { titular: 'José Ramón Miranda', banco: 'Banco Popular Dominicano', tipo: 'Crédito' },
  '7214': { titular: 'Myriam Laval', banco: 'Banreservas', tipo: 'Crédito' },
  '3301': { titular: 'José Ramón Miranda', banco: 'Banco BHD', tipo: 'Crédito' },
  '9012': { titular: 'Jeannette A. Mejia', banco: 'Banco Popular Dominicano', tipo: 'Débito' }
};

// Formateadores
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

  // 1. FILTRO ESTRICTO: ¿Es realmente un consumo con tarjeta?
  const isCard = text.includes('tarjeta') || text.includes('card') || text.includes('tdc') || 
                 text.includes('tdd') || text.includes('visa') || text.includes('mastercard') || 
                 text.includes('pos') || text.includes('consumo') || text.includes('aprobada') ||
                 text.includes('compra por internet') || text.includes('transaccion comercial');

  const isCashOrTransfer = (text.includes('transferencia recibida') || text.includes('transferencia enviada') ||
                           text.includes('retiro en cajero') || text.includes('deposito en efectivo') ||
                           text.includes('pago en ventanilla') || text.includes('pago en efectivo')) &&
                           !text.includes('tarjeta');

  if (isCashOrTransfer || !isCard) {
    throw new Error("Transacción rechazada: El correo no corresponde a un consumo con tarjeta corporativa (parece ser una transferencia, retiro o efectivo). Este módulo registra exclusivamente pagos con tarjeta.");
  }

  // 2. DETECCIÓN DE BANCO
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

  // 3. DETECCIÓN DE ÚLTIMOS 4 DÍGITOS DE TARJETA
  let tarjeta = '0000';
  const tarjetaMatch = rawText.match(/terminada en\s*[:#*]?\s*(\d{4})/i) ||
                       rawText.match(/tarjeta\s*[:*#]?\s*[*xX\s]{2,12}(\d{4})/i) ||
                       rawText.match(/[*xX]{4}\s*(\d{4})/i) ||
                       rawText.match(/no\.\s*[*xX\s]*(\d{4})/i) ||
                       rawText.match(/(\d{4})\s*aprobada/i);
  if (tarjetaMatch) {
    tarjeta = tarjetaMatch[1];
  }

  // 4. DETECCIÓN DE MONEDA Y MONTO
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

  // 5. DETECCIÓN DE COMERCIO / ESTABLECIMIENTO
  let comercio = 'Comercio Corporativo';
  const comercioMatch = rawText.match(/en[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/comercio[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/establecimiento[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/realizado en[:\s]+([^\n\r,.;]+)/i) ||
                        rawText.match(/lugar[:\s]+([^\n\r,.;]+)/i);

  if (comercioMatch && comercioMatch[1]) {
    comercio = comercioMatch[1].trim().replace(/^[:\-\s]+/, '').slice(0, 50);
  }

  // 6. DETECCIÓN DE AUTORIZACIÓN / APROBACIÓN
  let autorizacion = 'AUT-' + Math.floor(100000 + Math.random() * 900000);
  const autMatch = rawText.match(/autorizaci[oó]n[:\s]+([A-Za-z0-9]+)/i) ||
                   rawText.match(/aprobaci[oó]n[:\s]+([A-Za-z0-9]+)/i) ||
                   rawText.match(/no\.?\s*(?:de\s*)?aprobaci[oó]n[:\s]+([A-Za-z0-9]+)/i) ||
                   rawText.match(/ref[:\s]+([A-Za-z0-9]+)/i);
  if (autMatch) {
    autorizacion = autMatch[1].trim();
  }

  // 7. FECHA Y HORA
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

  // 8. CATEGORIZACIÓN INTELIGENTE
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

  // 9. TITULAR ASIGNADO
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
    if (state.filters.tarjeta && t.tarjeta_ultimos4 !== state.filters.tarjeta) return false;
    if (state.filters.moneda && t.moneda !== state.filters.moneda) return false;
    if (state.filters.estado && t.estado_conciliacion !== state.filters.estado) return false;
    if (state.filters.mes && !t.fecha.startsWith(state.filters.mes)) return false;

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
  if (elPendientes) elPendientes.textContent = `${pendientes} pendientes`;
}

function renderVirtualCards() {
  const wrap = document.getElementById('cardsSlider');
  if (!wrap) return;

  // Agrupar por últimos 4 dígitos
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
      <div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--ink-soft); background: white; border-radius: 12px; border: 1px dashed var(--rule);">
        No hay tarjetas registradas aún. Procesa un correo de consumo para ver la tarjeta aquí.
      </div>
    `;
    return;
  }

  wrap.innerHTML = cardsList.map(c => {
    let bankClass = 'card-popular';
    const bLower = c.banco.toLowerCase();
    if (bLower.includes('reservas')) bankClass = 'card-reservas';
    else if (bLower.includes('bhd')) bankClass = 'card-bhd';

    let spendText = fmtDOP(c.totalDOP);
    if (c.totalUSD > 0) {
      spendText += ` + ${fmtUSD(c.totalUSD)}`;
    }

    return `
      <div class="virtual-card ${bankClass}">
        <div class="vcard-header">
          <div class="vcard-chip"></div>
          <div class="vcard-bank">${escapeHtml(c.banco)}</div>
        </div>
        <div class="vcard-num">•••• •••• •••• ${c.tarjeta}</div>
        <div class="vcard-footer">
          <div>
            <div class="vcard-holder">${escapeHtml(c.titular)}</div>
            <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">Tarjeta de ${c.tipo} (${c.count} ops)</div>
          </div>
          <div class="vcard-spend">
            <div class="vcard-spend-label">Gasto Total</div>
            <div class="vcard-spend-val">${spendText}</div>
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
  if (countSpan) countSpan.textContent = `Mostrando ${list.length} movimientos`;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: var(--ink-soft);">
          No se encontraron consumos con tarjeta que coincidan con los filtros aplicados.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(t => {
    let badgeClass = 'badge-warning';
    if (t.estado_conciliacion === 'Conciliado') badgeClass = 'badge-success';
    else if (t.estado_conciliacion === 'Factura Adjunta') badgeClass = 'badge-card';

    const formattedMonto = t.moneda === 'USD' ? fmtUSD(t.monto) : fmtDOP(t.monto);

    return `
      <tr>
        <td>
          <div style="font-weight: 600;">${t.fecha}</div>
          <div style="font-size: 11px; color: var(--ink-soft);">${t.hora || '—'}</div>
        </td>
        <td>
          <span class="badge badge-card">💳 •••• ${t.tarjeta_ultimos4}</span>
          <div style="font-size: 11px; color: var(--ink-soft); margin-top: 3px;">${escapeHtml(t.banco)}</div>
        </td>
        <td>
          <div style="font-weight: 600; color: var(--primary);">${escapeHtml(t.comercio)}</div>
          <div style="font-size: 11px; color: var(--ink-soft);">Titular: ${escapeHtml(t.titular || '—')}</div>
        </td>
        <td>
          <span class="badge badge-cat">${escapeHtml(t.categoria)}</span>
        </td>
        <td>
          <code style="font-size: 11px; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeHtml(t.num_autorizacion || '—')}</code>
        </td>
        <td style="font-weight: 700; font-size: 15px; color: var(--ink);">
          ${formattedMonto}
        </td>
        <td>
          <span class="badge ${badgeClass}">${escapeHtml(t.estado_conciliacion)}</span>
          ${t.ncf ? `<div style="font-size: 10px; color: var(--ink-soft); margin-top: 3px;">NCF: ${escapeHtml(t.ncf)}</div>` : ''}
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline btn-sm" onclick="window.cambiarEstado('${t.id}')" title="Conciliar / Cambiar estado">
              ✓
            </button>
            <button class="btn btn-outline btn-sm" onclick="window.eliminarGasto('${t.id}')" title="Eliminar registro" style="color: var(--danger); border-color: #fecaca;">
              ✕
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// =========================================================================
// ACCIONES Y MODALES
// =========================================================================
function showToast(msg, isError = false) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isError) toast.style.background = '#dc2626';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// Exponer funciones globales para botones
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
  showToast(`Estado cambiado a ${nuevoEstado}`);
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
  showToast("Registro de gasto eliminado");
};

// =========================================================================
// EVENT LISTENERS DE LA PÁGINA
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  fetchTransactions();

  // Modales
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

  // Cerrar modales
  document.querySelectorAll('.modal-close, .btn-close-modal').forEach(btn => {
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

      // Mostrar preview
      document.getElementById('previewBanco').textContent = parsed.banco;
      document.getElementById('previewTarjeta').textContent = `•••• ${parsed.tarjeta_ultimos4}`;
      document.getElementById('previewComercio').textContent = parsed.comercio;
      document.getElementById('previewMonto').textContent = parsed.moneda === 'USD' ? fmtUSD(parsed.monto) : fmtDOP(parsed.monto);
      document.getElementById('previewCategoria').textContent = parsed.categoria;
      document.getElementById('previewAut').textContent = parsed.num_autorizacion;
      document.getElementById('previewTitular').textContent = parsed.titular;
      document.getElementById('previewFechaHora').textContent = `${parsed.fecha} a las ${parsed.hora}`;

      document.getElementById('aiResultBox').style.display = 'block';
      document.getElementById('btnConfirmAi').style.display = 'inline-flex';
    } catch (err) {
      alert("❌ " + err.message);
    }
  });

  // Confirmar y Guardar Transacción de IA
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
    showToast("¡Gasto con tarjeta extraído y registrado con éxito!");
  });

  // Formulario Manual
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
      num_autorizacion: document.getElementById('manualAut').value || 'MANUAL-' + Date.now().toString().slice(-4),
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
    showToast("Gasto con tarjeta guardado correctamente");
  });

  // Filtros
  document.getElementById('filterBanco')?.addEventListener('change', e => {
    state.filters.banco = e.target.value;
    render();
  });
  document.getElementById('filterTarjeta')?.addEventListener('change', e => {
    state.filters.tarjeta = e.target.value;
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
