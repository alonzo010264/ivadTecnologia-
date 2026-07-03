const CATEGORIAS = [
  "Dominio y hosting",
  "Software y suscripciones",
  "Insumos de oficina",
  "Marketing y publicidad",
  "Servicios (luz, agua, internet)",
  "Renta",
  "Mercancía / Inventario",
  "Transporte y envíos",
  "Nómina y honorarios",
  "Impuestos y comisiones",
  "Mantenimiento",
  "Otros"
];
const METODOS = ["Efectivo", "Transferencia", "Tarjeta débito", "Tarjeta crédito", "PayPal", "Otro"];
const PALETTE = ["#1a2a5e", "#c9a961", "#4a5a8a", "#b04545", "#6d7ba5", "#8a6a3a", "#3a4a7e", "#a08050", "#556699", "#c47070", "#7a8ab5", "#b89050"];
const INK = "#1a2a5e";
const STORAGE_KEY = "ivad_expenses_v1";

const fmtMXN = n => new Intl.NumberFormat("es-DO", { style: "currency", currency: "DOP", minimumFractionDigits: 2 }).format(n || 0);
const $ = s => document.querySelector(s);

let state = { rows: [], filterMes: "", filterCat: "", editingId: null };
let pieChart, barChart;

// Inicialización de Supabase
const supabaseUrl = "https://rbtdahmhaksdvupsmkma.supabase.co";
const supabaseKey = "sb_publishable_GP8roaav6iIHoQfFp7ncBg_slCdxC7S";
let supabaseClient = null;

if (window.supabase) {
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.rows));
}

// Llenar listas desplegables
function initSelects() {
  const cat = $("#catSelect");
  const met = $("#metSelect");
  const fcat = $("#filterCat");

  // Limpiar antes de llenar para evitar duplicados
  cat.innerHTML = "";
  fcat.innerHTML = '<option value="">Todas</option>';
  met.innerHTML = "";

  CATEGORIAS.forEach(c => {
    cat.insertAdjacentHTML("beforeend", `<option>${c}</option>`);
    fcat.insertAdjacentHTML("beforeend", `<option>${c}</option>`);
  });
  fcat.insertAdjacentHTML("beforeend", `<option>Reposición</option>`);

  METODOS.forEach(m => met.insertAdjacentHTML("beforeend", `<option>${m}</option>`));
  $("[name=fecha]").value = new Date().toISOString().slice(0, 10);
}

function updateMesFilter() {
  const set = new Set(state.rows.map(r => r.fecha.slice(0, 7)));
  const arr = [...set].sort().reverse();
  const sel = $("#filterMes");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + arr.map(m => {
    const [y, mm] = m.split("-");
    const label = new Date(+y, +mm - 1, 1).toLocaleDateString("es-DO", { month: "long", year: "numeric" });
    return `<option value="${m}">${label}</option>`;
  }).join("");
  sel.value = cur;
}

function filtered() {
  return state.rows.filter(r => {
    if (state.filterMes && !r.fecha.startsWith(state.filterMes)) return false;
    if (state.filterCat && r.categoria !== state.filterCat) return false;
    return true;
  });
}

function render() {
  updateMesFilter();
  const list = filtered();
  
  let totalEgresos = 0;
  let totalIngresos = 0;
  let countEgresos = 0;
  let countIngresos = 0;

  list.forEach(r => {
    const t = r.tipo || 'Egreso';
    if (t === 'Egreso') {
      totalEgresos += Number(r.monto);
      countEgresos++;
    } else {
      totalIngresos += Number(r.monto);
      countIngresos++;
    }
  });

  const saldo = totalIngresos - totalEgresos;

  $("#kpiSaldo").textContent = fmtMXN(saldo);
  $("#kpiSaldo").style.color = "#1a2a5e";
  $("#kpiEgresos").textContent = fmtMXN(totalEgresos);
  $("#kpiEgresosCount").textContent = `${countEgresos} Gastos`;
  $("#kpiIngresos").textContent = fmtMXN(totalIngresos);
  $("#kpiIngresosCount").textContent = `${countIngresos} Reposiciones`;
  $("#clearFilters").style.display = (state.filterMes || state.filterCat) ? "" : "none";

  renderCharts(list);
  renderTable(list, totalEgresos);
}

function renderCharts(list) {
  const wrap = $("#chartsWrap");
  wrap.style.display = list.length ? "" : "none";
  if (!list.length) return;

  // Filtrar solo egresos para el desglose por categorías
  const egresosOnly = list.filter(r => (r.tipo || 'Egreso') === 'Egreso');

  const byCat = {};
  egresosOnly.forEach(r => byCat[r.categoria] = (byCat[r.categoria] || 0) + Number(r.monto));
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const byMonth = {};
  state.rows.forEach(r => {
    const k = r.fecha.slice(0, 7);
    const isEgreso = (r.tipo || 'Egreso') === 'Egreso';
    const val = isEgreso ? -Number(r.monto) : Number(r.monto);
    byMonth[k] = (byMonth[k] || 0) + val;
  });
  const monthEntries = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const monthLabels = monthEntries.map(([k]) => {
    const [y, m] = k.split("-");
    return new Date(+y, +m - 1, 1).toLocaleDateString("es-DO", { month: "short", year: "2-digit" });
  });

  // Gráfico Circular (Categorías - Solo Egresos)
  const pieData = {
    labels: catEntries.map(e => e[0]),
    datasets: [{
      data: catEntries.map(e => +e[1].toFixed(2)),
      backgroundColor: catEntries.map((_, i) => PALETTE[i % PALETTE.length]),
      borderWidth: 2,
      borderColor: "#fff"
    }]
  };
  if (pieChart) pieChart.destroy();
  pieChart = new Chart($("#pieChart"), {
    type: "doughnut",
    data: pieData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "55%",
      plugins: {
        legend: { position: "bottom", labels: { font: { size: 11 }, boxWidth: 12, padding: 8 } },
        tooltip: { callbacks: { label: c => ` ${c.label}: ${fmtMXN(c.parsed)}` } }
      }
    }
  });

  // Gráfico de Barras (Historial Mensual Neto - Ingresos - Egresos)
  if (barChart) barChart.destroy();
  barChart = new Chart($("#barChart"), {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [{
        data: monthEntries.map(e => +e[1].toFixed(2)),
        backgroundColor: monthEntries.map(e => e[1] >= 0 ? "#c9a961" : "#1a2a5e"),
        borderRadius: 6,
        barThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` Balance: ${fmtMXN(c.parsed.y)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: INK, font: { size: 12 } } },
        y: { grid: { color: "rgba(0,0,0,.06)" }, ticks: { color: INK, font: { size: 11 }, callback: v => (v >= 0 ? "+" : "") + "RD$ " + (v / 1000).toFixed(0) + "k" } }
      }
    }
  });
}

function renderTable(list, total) {
  const wrap = $("#tableWrap");
  if (!list.length) {
    wrap.innerHTML = `<div class="empty"><h3>Sin movimientos registrados</h3><p>Registra el primer movimiento para empezar a llevar el control.</p></div>`;
    return;
  }
  wrap.innerHTML = `
  <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th>Proveedor</th><th>Método</th><th class="right">Monto</th><th style="text-align:center">Evidencia</th><th style="text-align:center">Comprobante</th><th style="text-align:center">Acciones</th>
      </tr></thead>
      <tbody>
        ${list.map(r => {
          const isIngreso = (r.tipo || 'Egreso') === 'Ingreso';
          const typeLabel = isIngreso ? "Ingreso" : "Egreso";
          const typeChipColor = isIngreso ? "background:#fbf8f0;color:#a67c1e;border:1px solid #e9dcb9;" : "background:#ebedf2;color:#1a2a5e;border:1px solid #d1d5e3;";
          const catLabel = isIngreso ? "Reposición" : r.categoria;
          const displayMonto = (isIngreso ? "+" : "-") + fmtMXN(Number(r.monto));
          const montoStyle = isIngreso ? "color:#a67c1e;font-weight:600;white-space:nowrap;" : "color:var(--ink);font-weight:600;white-space:nowrap;";
          return `
          <tr>
            <td>${new Date(r.fecha + "T00:00:00").toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}</td>
            <td><span class="chip" style="${typeChipColor}">${typeLabel}</span></td>
            <td><span class="chip">${catLabel}</span></td>
            <td>${escapeHtml(r.descripcion)}${r.notas ? `<div class="note">${escapeHtml(r.notes || r.notas)}</div>` : ""}</td>
            <td class="muted">${isIngreso ? '—' : (r.proveedor ? escapeHtml(r.proveedor) : "—")}</td>
            <td class="muted">${isIngreso ? 'Efectivo' : r.metodo_pago}</td>
            <td class="right" style="${montoStyle}">${displayMonto}</td>
            <td style="text-align:center">
              ${r.evidencia ? `<button class="btn btn-outline view-receipt-btn" data-id="${r.id}" style="padding: 4px 8px; font-size: 11px; display: inline-block;">🔍 Ver recibo</button>` : `<span style="color:var(--muted);font-style:italic">—</span>`}
            </td>
            <td style="text-align:center">
              <button class="btn btn-outline print-btn" data-id="${r.id}" style="padding: 4px 8px; font-size: 11px; display: inline-block;">🖨 Imprimir</button>
            </td>
            <td style="text-align:center; white-space:nowrap;">
              <button class="btn btn-outline edit-btn" data-id="${r.id}" style="padding: 4px 8px; font-size: 11px; display: inline-block; margin-right: 4px;">✏️ Editar</button>
              <button class="del-btn" data-id="${r.id}" style="padding: 4px 8px; font-size: 11px; display: inline-block;" title="Eliminar">🗑</button>
            </td>
          </tr>`;
        }).join("")}
      </tbody>
      <tfoot><tr>
        <td colspan="6" class="right" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)">Total Gastos (Egresos)</td>
        <td class="right total" style="color:var(--danger)">${fmtMXN(total)}</td><td></td><td></td><td></td>
      </tr></tfoot>
    </table>
  </div>`;

  wrap.querySelectorAll(".view-receipt-btn").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      const row = state.rows.find(r => r.id === id);
      if (row && row.evidencia) {
        $("#fullReceiptImg").src = row.evidencia;
        $("#receiptModal").hidden = false;
      }
    });
  });

  wrap.querySelectorAll(".print-btn").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      const row = state.rows.find(r => r.id === id);
      if (row) {
        imprimirComprobante(row);
      }
    });
  });

  wrap.querySelectorAll(".edit-btn").forEach(b => {
    b.addEventListener("click", () => {
      const id = b.dataset.id;
      const row = state.rows.find(r => r.id === id);
      if (row) {
        state.editingId = row.id;
        $("#modalTag").textContent = "EDITAR REGISTRO";
        $("#modalTitle").textContent = "Editar movimiento";
        $("#saveBtn").textContent = "Guardar cambios";
        
        // Cargar datos
        const f = $("#expenseForm");
        f.querySelector("[name=fecha]").value = row.fecha;
        $("#typeSelect").value = row.tipo || "Egreso";
        $("#typeSelect").dispatchEvent(new Event("change"));
        
        f.querySelector("[name=monto]").value = row.monto;
        f.querySelector("[name=descripcion]").value = row.descripcion;
        f.querySelector("[name=notas]").value = row.notas || "";
        
        if ((row.tipo || "Egreso") === "Egreso") {
          f.querySelector("[name=categoria]").value = row.categoria;
          f.querySelector("[name=metodo_pago]").value = row.metodo_pago;
          f.querySelector("[name=proveedor]").value = row.proveedor || "";
        }
        
        // Evidencia / Recibo preview
        if (row.evidencia) {
          evidenceBase64 = row.evidencia;
          evidenceEmpty.style.display = "none";
          evidencePreview.style.display = "flex";
          evidenceThumb.src = row.evidencia;
          const sizeInKb = Math.round((row.evidencia.length * 3) / 4 / 1024);
          evidenceSize.textContent = `${sizeInKb} KB (Comprimido)`;
          evidenceArea.style.borderColor = "var(--gold)";
        } else {
          evidenceInput.value = "";
          evidenceBase64 = null;
          evidenceThumb.src = "";
          evidenceEmpty.style.display = "block";
          evidencePreview.style.display = "none";
          evidenceArea.style.borderColor = "var(--rule)";
        }
        
        $("#modal").hidden = false;
      }
    });
  });

  wrap.querySelectorAll(".del-btn").forEach(b => {
    b.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este registro? Esta acción no se puede deshacer.")) return;
      const id = b.dataset.id;
      if (supabaseClient && id.includes("-")) {
        try {
          const { error } = await supabaseClient.from('control_gastos').delete().eq('id', id);
          if (error) throw error;
        } catch (err) {
          alert("Error al eliminar en la base de datos: " + err.message);
          return;
        }
      }
      state.rows = state.rows.filter(r => r.id !== id);
      save();
      render();
    });
  });
}

function imprimirComprobante(row) {
  const seqId = (row.id || "TEMP").slice(0, 8).toUpperCase();
  const fechaRegistro = row.created_at ? new Date(row.created_at).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" }) : "—";
  const fechaMovimiento = new Date(row.fecha + "T00:00:00").toLocaleDateString("es-DO", { day: "2-digit", month: "2-digit", year: "numeric" });
  const tipo = (row.tipo || "Egreso") === "Ingreso" ? "Reposición (Ingreso)" : "Gasto (Egreso)";
  const metodo = (row.tipo || "Egreso") === "Ingreso" ? "Efectivo" : row.metodo_pago;
  const categoria = (row.tipo || "Egreso") === "Ingreso" ? "Reposición" : row.categoria;
  const monto = fmtMXN(Number(row.monto));
  const proveedor = row.proveedor ? escapeHtml(row.proveedor) : "—";
  const descripcion = escapeHtml(row.descripcion);
  const notas = row.notas ? escapeHtml(row.notas) : "—";
  
  let evidenciaHtml = "";
  if (row.evidencia) {
    evidenciaHtml = `
      <div class="section-title">Evidencia / Recibo</div>
      <div class="evidence-area">
        <img src="${row.evidencia}" alt="Recibo" />
      </div>
    `;
  }
  
  const w = window.open("", "_blank");
  w.document.write(`
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Recibo CC-${seqId}</title>
  <style>
    body { font-family: 'Inter', sans-serif; color: #1a2a5e; margin: 0; padding: 40px; background: #fff; }
    .ticket { max-width: 800px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1a2a5e; padding-bottom: 20px; margin-bottom: 20px; }
    .header img { height: 60px; width: auto; }
    .header-title { text-align: right; }
    .header-title h1 { font-size: 20px; margin: 0 0 5px 0; color: #1a2a5e; font-family: 'Playfair Display', serif; }
    .header-title p { font-size: 11px; color: #6b6a63; margin: 0; }
    .voucher-num { font-weight: bold; display: inline-block; margin-top: 5px; font-size: 13px; color: #1a2a5e; }
    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px; border-bottom: 1px solid #1a2a5e; padding-bottom: 15px; }
    .meta-item { text-align: center; }
    .meta-item .label { font-size: 8px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #6b6a63; margin-bottom: 4px; }
    .meta-item .val { font-size: 12px; font-weight: 600; }
    .section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #6b6a63; border-bottom: 1px solid #e6e1d6; padding-bottom: 6px; margin-bottom: 15px; }
    .details-box { margin-bottom: 25px; display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
    .detail-cell { padding: 5px 0; }
    .detail-cell.full { grid-column: span 2; }
    .detail-cell .label { font-size: 9px; font-weight: 700; color: #6b6a63; text-transform: uppercase; margin-bottom: 4px; }
    .detail-cell .val { font-size: 13px; font-weight: 500; }
    .evidence-area { text-align: center; margin-bottom: 25px; padding: 10px 0; }
    .evidence-area img { max-height: 350px; max-width: 100%; object-fit: contain; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; margin-top: 60px; margin-bottom: 30px; }
    .signature-line { border-top: 1px solid #1a2a5e; text-align: center; padding-top: 8px; font-size: 11px; color: #1a2a5e; font-weight: 500; }
    .footer { text-align: center; font-size: 9px; color: #6b6a63; border-top: 1px solid #e6e1d6; padding-top: 15px; margin-top: 20px; }
    @media print {
      body { padding: 0; }
      .ticket { border: none; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="ticket">
    <div class="header">
      <img src="https://gestion.ivadsrl.com/ivad-logo.png" alt="IVAD">
      <div class="header-title">
        <h1>RECIBO DE CAJA CHICA</h1>
        <p>Fecha de registro: ${fechaRegistro}</p>
        <div class="voucher-num">N° RECIBO: CC-${seqId}</div>
      </div>
    </div>
    
    <div class="meta-grid">
      <div class="meta-item">
        <div class="label">Fecha Movimiento</div>
        <div class="val">${fechaMovimiento}</div>
      </div>
      <div class="meta-item">
        <div class="label">Tipo Movimiento</div>
        <div class="val">${tipo}</div>
      </div>
      <div class="meta-item">
        <div class="label">Método Pago</div>
        <div class="val">${metodo}</div>
      </div>
      <div class="meta-item">
        <div class="label">N° Recibo</div>
        <div class="val">CC-${seqId}</div>
      </div>
    </div>

    <div class="section-title">Detalle del Movimiento</div>
    <div class="details-box">
      <div class="detail-cell">
        <div class="label">Monto (RD$)</div>
        <div class="val" style="font-size: 16px; font-weight: 700; color: #1a2a5e;">${monto}</div>
      </div>
      <div class="detail-cell">
        <div class="label">Proveedor</div>
        <div class="val">${proveedor}</div>
      </div>
      <div class="detail-cell full">
        <div class="label">Descripción</div>
        <div class="val">${descripcion}</div>
      </div>
      <div class="detail-cell full">
        <div class="label">Notas / Observaciones</div>
        <div class="val">${notas}</div>
      </div>
    </div>

    ${evidenciaHtml}

    <div class="signatures">
      <div>
        <div style="height: 50px;"></div>
        <div class="signature-line">Registrado por: Nombre y firma</div>
      </div>
      <div>
        <div style="height: 50px;"></div>
        <div class="signature-line">Aprobado por: Nombre y firma</div>
      </div>
    </div>

    <div class="footer">
      IVAD Home & Goods | Est. 1996<br>
      Todos los derechos reservados.
    </div>
  </div>
  <script>
    window.onload = function() {
      window.print();
      setTimeout(function() { window.close(); }, 500);
    };
  </script>
</body>
</html>
  `);
  w.document.close();
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function fetchExpenses() {
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('control_gastos')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      state.rows = data || [];
      save();
    } catch (err) {
      console.warn("No se pudo sincronizar con base de datos, usando copia local.", err);
      state.rows = load();
    }
  } else {
    state.rows = load();
  }
  render();
}

function startDashboard() {
  initSelects();
  fetchExpenses();
  
  if (supabaseClient) {
    supabaseClient
      .channel('control_gastos_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'control_gastos' }, () => {
        fetchExpenses();
      })
      .subscribe();
  }
}

// Control de Eventos
document.addEventListener("DOMContentLoaded", () => {
  const encodedPass = 'aXZhZEFkbWluMjAyNg=='; // Base64 de 'ivadAdmin2026'

  // Acciones del modal
  $("#closeModal").addEventListener("click", () => $("#modal").hidden = true);
  $("#cancelBtn").addEventListener("click", () => $("#modal").hidden = true);
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") $("#modal").hidden = true; });

  // Elementos del formulario para toggling dinámico
  const typeSelect = $("#typeSelect");
  const fldMetodo = $("#fldMetodo");
  const fldCategoria = $("#fldCategoria");
  const gridEgresoExtra = $("#gridEgresoExtra");
  const fldEvidencia = $("#fldEvidencia");
  const inputDescripcion = $("#inputDescripcion");

  typeSelect.addEventListener("change", () => {
    const isIngreso = typeSelect.value === "Ingreso";
    if (isIngreso) {
      // Reposición (Ingreso)
      fldMetodo.style.display = "none";
      fldCategoria.style.display = "none";
      gridEgresoExtra.style.display = "none";
      fldEvidencia.style.display = "none";
      inputDescripcion.placeholder = "Ej: Reposición de fondo de caja chica";
    } else {
      // Gasto (Egreso)
      fldMetodo.style.display = "";
      fldCategoria.style.display = "";
      gridEgresoExtra.style.display = "";
      fldEvidencia.style.display = "";
      inputDescripcion.placeholder = "Ej: Café y azúcar para oficina";
    }
  });

  const resetFormLayout = () => {
    state.editingId = null;
    $("#modalTag").textContent = "NUEVO REGISTRO";
    $("#modalTitle").textContent = "Registrar movimiento";
    $("#saveBtn").textContent = "Guardar registro";
    
    typeSelect.value = "Egreso";
    fldMetodo.style.display = "";
    fldCategoria.style.display = "";
    gridEgresoExtra.style.display = "";
    fldEvidencia.style.display = "";
    inputDescripcion.placeholder = "Ej: Café y azúcar para oficina";
  };

  $("#openModal").addEventListener("click", () => {
    resetFormLayout();
    $("#modal").hidden = false;
  });

  // Filtros
  $("#filterMes").addEventListener("change", e => { state.filterMes = e.target.value; render(); });
  $("#filterCat").addEventListener("change", e => { state.filterCat = e.target.value; render(); });
  $("#clearFilters").addEventListener("click", () => {
    state.filterMes = "";
    state.filterCat = "";
    $("#filterMes").value = "";
    $("#filterCat").value = "";
    render();
  });

  // Lógica de Evidencia / Captura de Recibo
  let evidenceBase64 = null;
  const evidenceArea = $("#evidenceArea");
  const evidenceInput = $("#evidenceInput");
  const evidenceEmpty = $("#evidenceEmpty");
  const evidencePreview = $("#evidencePreview");
  const evidenceThumb = $("#evidenceThumb");
  const evidenceSize = $("#evidenceSize");
  const removeEvidenceBtn = $("#removeEvidenceBtn");

  evidenceArea.addEventListener("click", e => {
    if (e.target !== removeEvidenceBtn && !removeEvidenceBtn.contains(e.target)) {
      evidenceInput.click();
    }
  });

  evidenceInput.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;

    evidenceEmpty.style.display = "none";
    evidencePreview.style.display = "flex";
    evidenceSize.textContent = "Comprimiendo recibo...";
    evidenceThumb.style.opacity = "0.4";

    const reader = new FileReader();
    reader.onload = function(evt) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        const maxDim = 1000;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Convertir a base64 JPEG con calidad 0.7 para no saturar la base de datos
        const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.7);
        evidenceBase64 = compressedDataUrl;

        evidenceThumb.src = compressedDataUrl;
        evidenceThumb.style.opacity = "1";
        
        const sizeInKb = Math.round((compressedDataUrl.length * 3) / 4 / 1024);
        evidenceSize.textContent = `${sizeInKb} KB (Comprimido)`;
        evidenceArea.style.borderColor = "var(--gold)";
      };
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  });

  removeEvidenceBtn.addEventListener("click", e => {
    e.stopPropagation();
    evidenceInput.value = "";
    evidenceBase64 = null;
    evidenceThumb.src = "";
    evidenceEmpty.style.display = "block";
    evidencePreview.style.display = "none";
    evidenceArea.style.borderColor = "var(--rule)";
  });

  // Modal para ver el Recibo en Grande
  const receiptModal = $("#receiptModal");
  const closeReceiptModal = $("#closeReceiptModal");
  const fullReceiptImg = $("#fullReceiptImg");

  closeReceiptModal.addEventListener("click", () => {
    receiptModal.hidden = true;
    fullReceiptImg.src = "";
  });
  receiptModal.addEventListener("click", e => {
    if (e.target.id === "receiptModal") {
      receiptModal.hidden = true;
      fullReceiptImg.src = "";
    }
  });

  // Registrar movimiento
  $("#expenseForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const tipoMov = f.get("tipo") || "Egreso";
    
    const row = {
      fecha: f.get("fecha"),
      tipo: tipoMov,
      monto: parseFloat(f.get("monto")),
      descripcion: f.get("descripcion").trim(),
      notas: (f.get("notas") || "").trim() || null,
      categoria: tipoMov === "Egreso" ? f.get("categoria") : "Reposición",
      metodo_pago: tipoMov === "Egreso" ? f.get("metodo_pago") : "Efectivo",
      proveedor: tipoMov === "Egreso" ? ((f.get("proveedor") || "").trim() || null) : null,
      evidencia: tipoMov === "Egreso" ? (evidenceBase64 || null) : null
    };

    if (state.editingId) {
      if (supabaseClient && state.editingId.includes("-")) {
        try {
          const { data, error } = await supabaseClient
            .from('control_gastos')
            .update(row)
            .eq('id', state.editingId)
            .select();
          if (error) throw error;
          if (data && data.length) {
            const idx = state.rows.findIndex(r => r.id === state.editingId);
            if (idx !== -1) state.rows[idx] = data[0];
          }
        } catch (err) {
          alert("Error al actualizar en la base de datos: " + err.message);
          return;
        }
      } else {
        const idx = state.rows.findIndex(r => r.id === state.editingId);
        if (idx !== -1) {
          row.id = state.editingId;
          row.created_at = state.rows[idx].created_at;
          state.rows[idx] = row;
        }
      }
    } else {
      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient
            .from('control_gastos')
            .insert([row])
            .select();
          if (error) throw error;
          if (data && data.length) {
            state.rows.unshift(data[0]);
            // Enviar correo de notificación
            fetch('https://recursohumanos.ivadsrl.com/api/notify-expense', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data[0])
            }).catch(err => console.error("Fallo al enviar notificación:", err));
          } else {
            row.id = String(Date.now());
            row.created_at = new Date().toISOString();
            state.rows.unshift(row);
          }
        } catch (err) {
          alert("Error al registrar en base de datos. Se registrará localmente. " + err.message);
          row.id = String(Date.now());
          row.created_at = new Date().toISOString();
          state.rows.unshift(row);
        }
      } else {
        row.id = String(Date.now());
        row.created_at = new Date().toISOString();
        state.rows.unshift(row);
      }
    }

    state.rows.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.created_at.localeCompare(a.created_at));
    save();
    
    // Resetear formulario y estado de evidencia
    e.target.reset();
    resetFormLayout();
    $("[name=fecha]").value = new Date().toISOString().slice(0, 10);
    evidenceInput.value = "";
    evidenceBase64 = null;
    evidenceThumb.src = "";
    evidenceEmpty.style.display = "block";
    evidencePreview.style.display = "none";
    evidenceArea.style.borderColor = "var(--rule)";
    
    $("#modal").hidden = true;
    render();
  });

  // Cerrar Sesión
  $("#logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem("ivad_gastos_auth");
    window.location.reload();
  });

  // Verificación de Login
  if (sessionStorage.getItem("ivad_gastos_auth") === "true") {
    $("#loginOverlay").style.display = "none";
    startDashboard();
  } else {
    $("#loginForm").addEventListener("submit", e => {
      e.preventDefault();
      const pass = $("#adminPass").value;
      if (window.btoa(pass) === encodedPass) {
        sessionStorage.setItem("ivad_gastos_auth", "true");
        $("#loginOverlay").style.display = "none";
        startDashboard();
      } else {
        $("#loginError").style.display = "block";
        $("#adminPass").value = "";
      }
    });
  }
});
