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

let state = { rows: [], filterMes: "", filterCat: "" };
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
  const total = list.reduce((s, r) => s + Number(r.monto), 0);
  const count = list.length;
  const avg = count ? total / count : 0;
  $("#kpiTotal").textContent = fmtMXN(total);
  $("#kpiCount").textContent = count;
  $("#kpiAvg").textContent = fmtMXN(avg);
  $("#kpiTotalSub").textContent = (state.filterMes || state.filterCat) ? "Con filtros aplicados" : "Histórico";
  $("#clearFilters").style.display = (state.filterMes || state.filterCat) ? "" : "none";

  renderCharts(list);
  renderTable(list, total);
}

function renderCharts(list) {
  const wrap = $("#chartsWrap");
  wrap.style.display = list.length ? "" : "none";
  if (!list.length) return;

  const byCat = {};
  list.forEach(r => byCat[r.categoria] = (byCat[r.categoria] || 0) + Number(r.monto));
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  const byMonth = {};
  state.rows.forEach(r => {
    const k = r.fecha.slice(0, 7);
    byMonth[k] = (byMonth[k] || 0) + Number(r.monto);
  });
  const monthEntries = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const monthLabels = monthEntries.map(([k]) => {
    const [y, m] = k.split("-");
    return new Date(+y, +m - 1, 1).toLocaleDateString("es-DO", { month: "short", year: "2-digit" });
  });

  // Gráfico Circular (Categorías)
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

  // Gráfico de Barras (Historial Mensual)
  if (barChart) barChart.destroy();
  barChart = new Chart($("#barChart"), {
    type: "bar",
    data: {
      labels: monthLabels,
      datasets: [{
        data: monthEntries.map(e => +e[1].toFixed(2)),
        backgroundColor: INK,
        borderRadius: 6,
        barThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ` ${fmtMXN(c.parsed.y)}` } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: INK, font: { size: 12 } } },
        y: { grid: { color: "rgba(0,0,0,.06)" }, ticks: { color: INK, font: { size: 11 }, callback: v => "$" + (v / 1000).toFixed(0) + "k" } }
      }
    }
  });
}

function renderTable(list, total) {
  const wrap = $("#tableWrap");
  if (!list.length) {
    wrap.innerHTML = `<div class="empty"><h3>Sin gastos registrados</h3><p>Registra el primer gasto para empezar a llevar el control.</p></div>`;
    return;
  }
  wrap.innerHTML = `
  <div style="overflow-x:auto">
    <table>
      <thead><tr>
        <th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Proveedor</th><th>Método</th><th class="right">Monto</th><th></th>
      </tr></thead>
      <tbody>
        ${list.map(r => `
          <tr>
            <td>${new Date(r.fecha + "T00:00:00").toLocaleDateString("es-DO", { day: "2-digit", month: "short", year: "numeric" })}</td>
            <td><span class="chip">${r.categoria}</span></td>
            <td>${escapeHtml(r.descripcion)}${r.notas ? `<div class="note">${escapeHtml(r.notas)}</div>` : ""}</td>
            <td class="muted">${r.proveedor ? escapeHtml(r.proveedor) : "—"}</td>
            <td class="muted">${r.metodo_pago}</td>
            <td class="right" style="font-weight:600;white-space:nowrap">${fmtMXN(Number(r.monto))}</td>
            <td><button class="del-btn" data-id="${r.id}" title="Eliminar">🗑</button></td>
          </tr>`).join("")}
      </tbody>
      <tfoot><tr>
        <td colspan="5" class="right" style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)">Total</td>
        <td class="right total">${fmtMXN(total)}</td><td></td>
      </tr></tfoot>
    </table>
  </div>`;

  wrap.querySelectorAll(".del-btn").forEach(b => {
    b.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este gasto? Esta acción no se puede deshacer.")) return;
      const id = b.dataset.id;
      if (supabaseClient && id.includes("-")) {
        try {
          const { error } = await supabaseClient.from('control_gastos').delete().eq('id', id);
          if (error) throw error;
        } catch (err) {
          alert("Error al eliminar el gasto en la base de datos: " + err.message);
          return;
        }
      }
      state.rows = state.rows.filter(r => r.id !== id);
      save();
      render();
    });
  });
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
      console.warn("Fallo al conectar con Supabase. Usando caché local.", err);
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
    // Escucha en tiempo real de cambios
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
  $("#openModal").addEventListener("click", () => $("#modal").hidden = false);
  $("#closeModal").addEventListener("click", () => $("#modal").hidden = true);
  $("#cancelBtn").addEventListener("click", () => $("#modal").hidden = true);
  $("#modal").addEventListener("click", e => { if (e.target.id === "modal") $("#modal").hidden = true; });

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

  // Registrar gasto
  $("#expenseForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const row = {
      fecha: f.get("fecha"),
      categoria: f.get("categoria"),
      descripcion: f.get("descripcion").trim(),
      proveedor: (f.get("proveedor") || "").trim() || null,
      monto: parseFloat(f.get("monto")),
      metodo_pago: f.get("metodo_pago"),
      notas: (f.get("notas") || "").trim() || null
    };

    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from('control_gastos')
          .insert([row])
          .select();
        if (error) throw error;
        if (data && data.length) {
          state.rows.unshift(data[0]);
          // Enviar correo de notificación de forma asíncrona a través del servidor de RRHH
          fetch('https://recursohumanos.ivadsrl.com/api/notify-expense', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data[0])
          }).catch(err => console.error("Fallo al enviar notificación:", err));
        } else {
          row.id = String(Date.now());
          row.created_at = new Date().toISOString();
          state.rows.unshift(row);
          fetch('https://recursohumanos.ivadsrl.com/api/notify-expense', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(row)
          }).catch(err => console.error("Fallo al enviar notificación:", err));
        }
      } catch (err) {
        alert("Error al registrar en base de datos. Se registrará localmente de forma temporal. " + err.message);
        row.id = String(Date.now());
        row.created_at = new Date().toISOString();
        state.rows.unshift(row);
      }
    } else {
      row.id = String(Date.now());
      row.created_at = new Date().toISOString();
      state.rows.unshift(row);
    }

    state.rows.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.created_at.localeCompare(a.created_at));
    save();
    e.target.reset();
    $("[name=fecha]").value = new Date().toISOString().slice(0, 10);
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
