import './style.css';
import {
  getEstudiantes,
  createEstudiante,
  updateEstudiante,
  deleteEstudiante,
  testSupabaseConnection,
  getActiveCredentials,
  saveLocalCredentials,
  clearLocalCredentials,
  subscribeToEstudiantesChanges,
  SQL_SETUP_SCRIPT
} from './supabase.js';

// Estado global de la aplicación
let estudiantes = [];
let editingStudentId = null;
let searchQuery = '';
let currentFilter = 'all'; // 'all' | 'approved' | 'failed'
let sortField = 'promedio';
let sortDirection = 'desc';
let studentPendingDelete = null;
let connectionStatus = { connected: false, status: 'checking', message: 'Comprobando...' };
let realtimeChannel = null;

// Elemento contenedor principal
const app = document.getElementById('app');

/**
 * Muestra notificación flotante (Toast)
 */
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.borderColor = type === 'success' ? 'var(--approved-color)' : type === 'error' ? 'var(--failed-color)' : 'var(--brand-cyan)';
  toast.innerText = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/**
 * Exporta el listado completo a formato CSV compatible con Microsoft Excel
 */
function exportToCsv() {
  if (estudiantes.length === 0) {
    showToast('No hay estudiantes registrados para exportar.', 'error');
    return;
  }

  const ranking = [...estudiantes].sort((a, b) => parseFloat(b.promedio) - parseFloat(a.promedio));
  const headers = ['Puesto', 'Código', 'Apellidos', 'Nombres', 'Curso', 'Nota 1', 'Nota 2', 'Nota 3', 'Promedio', 'Condición'];
  
  const rows = ranking.map((st, idx) => [
    idx + 1,
    `"${st.codigo}"`,
    `"${st.apellidos}"`,
    `"${st.nombres}"`,
    `"${st.curso || 'Lenguajes de Programación'}"`,
    parseFloat(st.nota1).toFixed(1),
    parseFloat(st.nota2).toFixed(1),
    parseFloat(st.nota3).toFixed(1),
    parseFloat(st.promedio).toFixed(2),
    `"${st.condicion}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `Registro_Notas_SIS224_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('¡Archivo CSV descargado con éxito!', 'success');
}

/**
 * Dispara la vista de impresión de acta oficial
 */
function printReport() {
  window.print();
}

/**
 * Calcula promedio y condición según reglas de negocio
 * Rango notas: 0 a 20
 * >= 11: APROBADO
 * < 11: DESAPROBADO
 */
function calculateGradeDetails(n1, n2, n3) {
  const val1 = parseFloat(n1);
  const val2 = parseFloat(n2);
  const val3 = parseFloat(n3);

  const isN1Valid = !isNaN(val1) && val1 >= 0 && val1 <= 20;
  const isN2Valid = !isNaN(val2) && val2 >= 0 && val2 <= 20;
  const isN3Valid = !isNaN(val3) && val3 >= 0 && val3 <= 20;

  if (!isN1Valid || !isN2Valid || !isN3Valid) {
    return {
      isValid: false,
      promedio: null,
      promedioFormatted: '—',
      condicion: 'PENDIENTE',
      fillPercentage: 0,
      formulaText: 'Ingresa las 3 notas (0 - 20) para calcular',
    };
  }

  const promedio = Math.round(((val1 + val2 + val3) / 3) * 100) / 100;
  const condicion = promedio >= 11 ? 'APROBADO' : 'DESAPROBADO';
  const fillPercentage = Math.min(Math.max((promedio / 20) * 100, 0), 100);

  return {
    isValid: true,
    promedio,
    promedioFormatted: promedio.toFixed(2),
    condicion,
    fillPercentage,
    formulaText: `(${val1.toFixed(1)} + ${val2.toFixed(1)} + ${val3.toFixed(1)}) ÷ 3 = ${promedio.toFixed(2)}`,
  };
}

/**
 * Renderiza la interfaz de usuario completa
 */
function renderApp() {
  const creds = getActiveCredentials();
  const total = estudiantes.length;
  const aprobados = estudiantes.filter(e => e.condicion === 'APROBADO').length;
  const desaprobados = estudiantes.filter(e => e.condicion === 'DESAPROBADO').length;
  const porcAprobados = total > 0 ? Math.round((aprobados / total) * 100) : 0;
  const porcDesaprobados = total > 0 ? Math.round((desaprobados / total) * 100) : 0;
  
  const promedioGeneral = total > 0 
    ? (estudiantes.reduce((acc, curr) => acc + parseFloat(curr.promedio), 0) / total).toFixed(2)
    : '0.00';

  // Ranking ordenado de mayor a menor calificación
  const rankingEstudiantes = [...estudiantes].sort((a, b) => parseFloat(b.promedio) - parseFloat(a.promedio));
  const topStudent = rankingEstudiantes.length > 0 ? rankingEstudiantes[0] : null;
  const topThree = rankingEstudiantes.slice(0, 3);

  // Distribución de Calificaciones
  const sobCount = estudiantes.filter(e => parseFloat(e.promedio) >= 18).length;
  const notCount = estudiantes.filter(e => parseFloat(e.promedio) >= 14 && parseFloat(e.promedio) < 18).length;
  const regCount = estudiantes.filter(e => parseFloat(e.promedio) >= 11 && parseFloat(e.promedio) < 14).length;
  const desCount = estudiantes.filter(e => parseFloat(e.promedio) < 11).length;

  const sobPct = total > 0 ? (sobCount / total) * 100 : 0;
  const notPct = total > 0 ? (notCount / total) * 100 : 0;
  const regPct = total > 0 ? (regCount / total) * 100 : 0;
  const desPct = total > 0 ? (desCount / total) * 100 : 0;

  app.innerHTML = `
    <!-- Encabezado exclusivo para Impresión Oficial de Acta -->
    <div class="print-only-header">
      <h1 style="font-size: 15pt; font-weight: 800; margin-bottom: 3px;">UNIVERSIDAD NACIONAL DEL ALTIPLANO</h1>
      <h2 style="font-size: 12pt; font-weight: 700; margin-bottom: 3px;">FACULTAD DE INGENIERÍA MECÁNICA ELÉCTRICA, ELECTRÓNICA Y SISTEMAS</h2>
      <h3 style="font-size: 11pt; font-weight: 600; margin-bottom: 6px;">ACTA OFICIAL DE REGISTRO DE CALIFICACIONES</h3>
      <p style="font-size: 9.5pt;"><strong>Asignatura:</strong> SIS224 - Lenguajes de Programación &nbsp;|&nbsp; <strong>Fecha:</strong> ${new Date().toLocaleDateString('es-ES')}</p>
    </div>

    <!-- Barra de Navegación -->
    <header class="site-header">
      <div class="container nav-wrapper">
        <a href="#" class="brand-link">
          <div class="brand-icon">🎓</div>
          <div>
            <div class="brand-title">Sistema de Registro de Notas</div>
            <div class="brand-subtitle">SIS224 • Lenguajes de Programación</div>
          </div>
        </a>

        <div class="nav-controls">
          <div id="statusBadge" class="status-badge ${
            connectionStatus.status === 'ready' ? 'connected' :
            connectionStatus.status === 'unconfigured' ? 'local' : 'error'
          }">
            <span class="dot"></span>
            <span id="statusBadgeText">${
              connectionStatus.status === 'ready' ? `Supabase en línea (${connectionStatus.latency}ms)` :
              connectionStatus.status === 'table_missing' ? 'Falta tabla en Supabase' :
              connectionStatus.status === 'unconfigured' ? 'Modo Local (Sin Supabase)' : 'Error Supabase'
            }</span>
          </div>

          <button id="btnSyncData" class="btn btn-secondary" title="Sincronizar ahora con Supabase">
            🔄 Sincronizar
          </button>
          <button id="btnOpenSqlModal" class="btn btn-secondary" title="Ver código SQL para Supabase">
            📜 SQL Supabase
          </button>
          <button id="btnOpenConfigModal" class="btn btn-secondary" title="Configurar conexión">
            ⚙️ Conexión
          </button>
        </div>
      </div>
    </header>

    <main class="container">
      <!-- Banner Hero y Estadísticas -->
      <section class="hero-banner">
        <div class="hero-header">
          <div>
            <h1>Gestión Académica de <span class="gradient-text">Calificaciones</span></h1>
            <p>Registra notas de 0 a 20 con cálculo automático de promedio, ranking de honor y condición aprobatoria (≥ 11).</p>
          </div>

          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button id="btnExportCsv" class="btn btn-secondary">
              📥 Exportar CSV / Excel
            </button>
            <button id="btnPrintReport" class="btn btn-secondary">
              🖨️ Imprimir Acta Oficial
            </button>
          </div>
        </div>

        <!-- Indicadores Clave (KPIs) -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Total Alumnos <span>👥</span></div>
            <div class="kpi-value">${total}</div>
            <div class="kpi-subtext">Estudiantes registrados</div>
          </div>

          <div class="kpi-card approved">
            <div class="kpi-label">Aprobados <span>✅</span></div>
            <div class="kpi-value" style="color: var(--approved-color);">${aprobados}</div>
            <div class="kpi-subtext">${porcAprobados}% del aula (Nota ≥ 11)</div>
          </div>

          <div class="kpi-card failed">
            <div class="kpi-label">Desaprobados <span>❌</span></div>
            <div class="kpi-value" style="color: var(--failed-color);">${desaprobados}</div>
            <div class="kpi-subtext">${porcDesaprobados}% del aula (Nota &lt; 11)</div>
          </div>

          <div class="kpi-card average">
            <div class="kpi-label">Promedio General <span>📊</span></div>
            <div class="kpi-value" style="color: var(--brand-purple);">${promedioGeneral}</div>
            <div class="kpi-subtext">Escala vigesimal (0 - 20)</div>
          </div>

          <!-- KPI de Mejor Estudiante -->
          <div class="kpi-card top-student">
            <div class="kpi-label">🏆 Mayor Calificación <span>🥇</span></div>
            <div class="kpi-value" style="color: #fbbf24;">${topStudent ? parseFloat(topStudent.promedio).toFixed(2) : '—'}</div>
            <div class="kpi-subtext" style="color: #fef08a; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${topStudent ? `${topStudent.nombres} ${topStudent.apellidos}` : 'Sin estudiantes'}
            </div>
          </div>
        </div>

        <!-- Cuadro de Honor y Ranking Destacado -->
        ${topStudent ? `
          <div class="ranking-banner">
            <div class="ranking-banner-header">
              <div>
                <span class="ranking-badge-pill">🏆 Cuadro de Honor • Máxima Calificación</span>
                <h2 style="font-size: 1.45rem; font-weight: 800; margin-top: 0.35rem; color: #ffffff;">
                  Primer Puesto del Salón
                </h2>
              </div>
              <div style="font-size: 0.85rem; color: #fde047; font-family: var(--font-mono); font-weight: 600;">
                ★ Reconocimiento Académico SIS224 ★
              </div>
            </div>

            <!-- Estudiante con Mayor Nota -->
            <div class="top-student-card">
              <div class="top-student-info">
                <div class="top-medal-avatar">🥇</div>
                <div>
                  <div class="top-student-name">${topStudent.nombres} ${topStudent.apellidos}</div>
                  <div class="top-student-meta">
                    <span><strong>Código:</strong> ${topStudent.codigo}</span>
                    <span>•</span>
                    <span><strong>Curso:</strong> ${topStudent.curso || 'Lenguajes de Programación'}</span>
                    <span>•</span>
                    <span><strong>Desglose:</strong> N1: ${parseFloat(topStudent.nota1).toFixed(1)} | N2: ${parseFloat(topStudent.nota2).toFixed(1)} | N3: ${parseFloat(topStudent.nota3).toFixed(1)}</span>
                  </div>
                </div>
              </div>

              <div class="top-student-score-box">
                <div class="top-score-num">${parseFloat(topStudent.promedio).toFixed(2)}</div>
                <div class="top-score-label">Promedio Más Alto / 20</div>
              </div>
            </div>

            <!-- Podio de Honor (Top 3) -->
            ${topThree.length > 1 ? `
              <div class="podium-grid">
                ${topThree.map((st, idx) => {
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉';
                  const rankName = idx === 0 ? '1° Puesto (Oro)' : idx === 1 ? '2° Puesto (Plata)' : '3° Puesto (Bronce)';
                  return `
                    <div class="podium-item rank-${idx + 1}">
                      <div class="podium-left">
                        <span class="podium-medal">${medal}</span>
                        <div class="podium-details">
                          <span class="podium-name">${st.nombres} ${st.apellidos}</span>
                          <span class="podium-code">${st.codigo} • ${rankName}</span>
                        </div>
                      </div>
                      <div class="podium-avg">${parseFloat(st.promedio).toFixed(2)}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : ''}
          </div>
        ` : ''}

        <!-- Barra de Distribución Académica -->
        ${total > 0 ? `
          <div class="analytics-card">
            <div class="analytics-title">
              <span>Distribución Académica de Rendimiento</span>
              <span style="font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-muted);">${total} Evaluados</span>
            </div>
            <div class="dist-bar-track">
              <div class="dist-segment sobresaliente" style="width: ${sobPct}%;" title="Sobresaliente (18-20): ${sobCount}"></div>
              <div class="dist-segment notable" style="width: ${notPct}%;" title="Notable (14-17): ${notCount}"></div>
              <div class="dist-segment regular" style="width: ${regPct}%;" title="Regular (11-13): ${regCount}"></div>
              <div class="dist-segment desaprobado" style="width: ${desPct}%;" title="Desaprobado (0-10): ${desCount}"></div>
            </div>
            <div class="dist-legend">
              <div class="dist-legend-item">
                <span class="dist-color-box" style="background: #10b981;"></span>
                <span>Sobresaliente [18-20]: <strong>${sobCount}</strong> (${Math.round(sobPct)}%)</span>
              </div>
              <div class="dist-legend-item">
                <span class="dist-color-box" style="background: #38bdf8;"></span>
                <span>Notable [14-17]: <strong>${notCount}</strong> (${Math.round(notPct)}%)</span>
              </div>
              <div class="dist-legend-item">
                <span class="dist-color-box" style="background: #fbbf24;"></span>
                <span>Regular [11-13]: <strong>${regCount}</strong> (${Math.round(regPct)}%)</span>
              </div>
              <div class="dist-legend-item">
                <span class="dist-color-box" style="background: #f43f5e;"></span>
                <span>Desaprobado [0-10]: <strong>${desCount}</strong> (${Math.round(desPct)}%)</span>
              </div>
            </div>
          </div>
        ` : ''}
      </section>

      <!-- Grid Principal: Formulario y Monitor Reactivo de Calificación -->
      <section class="layout-grid">
        <!-- Formulario de Registro / Edición -->
        <div class="panel">
          <h2 class="panel-title" id="formHeaderTitle">
            <span>📝</span> ${editingStudentId ? 'Editar Calificaciones del Estudiante' : 'Registrar Nuevo Estudiante'}
          </h2>
          <p class="panel-desc">
            ${editingStudentId ? 'Modifica los datos o calificaciones y guarda los cambios en Supabase.' : 'Ingresa el código del alumno, sus nombres y las 3 notas reglamentarias.'}
          </p>

          <form id="studentGradeForm">
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label" for="inputCodigo">
                  Código de Estudiante <span class="req">*</span>
                </label>
                <input 
                  type="text" 
                  id="inputCodigo" 
                  class="form-input" 
                  placeholder="Ej: 236055" 
                  required 
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="inputCurso">Asignatura / Curso</label>
                <input 
                  type="text" 
                  id="inputCurso" 
                  class="form-input" 
                  value="Lenguajes de Programación" 
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="inputNombres">
                  Nombres <span class="req">*</span>
                </label>
                <input 
                  type="text" 
                  id="inputNombres" 
                  class="form-input" 
                  placeholder="Ej: Anthony Joel" 
                  required 
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="inputApellidos">
                  Apellidos <span class="req">*</span>
                </label>
                <input 
                  type="text" 
                  id="inputApellidos" 
                  class="form-input" 
                  placeholder="Ej: Condori Ticona" 
                  required 
                />
              </div>

              <!-- Tres Notas -->
              <div class="form-group col-span-2">
                <label class="form-label">
                  Registro de 3 Notas Evaluativas (0 a 20) <span class="req">*</span>
                </label>
                
                <div class="grades-row">
                  <div class="grade-box">
                    <label for="inputNota1">NOTA 1</label>
                    <input 
                      type="number" 
                      id="inputNota1" 
                      class="form-input grade-input" 
                      placeholder="0 - 20" 
                      min="0" 
                      max="20" 
                      step="0.1" 
                      required 
                    />
                    <span class="input-hint">Examen / Tarea 1</span>
                  </div>

                  <div class="grade-box">
                    <label for="inputNota2">NOTA 2</label>
                    <input 
                      type="number" 
                      id="inputNota2" 
                      class="form-input grade-input" 
                      placeholder="0 - 20" 
                      min="0" 
                      max="20" 
                      step="0.1" 
                      required 
                    />
                    <span class="input-hint">Examen / Tarea 2</span>
                  </div>

                  <div class="grade-box">
                    <label for="inputNota3">NOTA 3</label>
                    <input 
                      type="number" 
                      id="inputNota3" 
                      class="form-input grade-input" 
                      placeholder="0 - 20" 
                      min="0" 
                      max="20" 
                      step="0.1" 
                      required 
                    />
                    <span class="input-hint">Proyecto / Práctica</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Botones de Acción -->
            <div class="form-actions">
              <button type="submit" id="btnSubmitForm" class="btn btn-primary">
                💾 ${editingStudentId ? 'Actualizar Estudiante' : 'Guardar y Calcular'}
              </button>
              <button type="button" id="btnResetForm" class="btn btn-secondary">
                🔄 Limpiar Formulario
              </button>
            </div>
          </form>
        </div>

        <!-- Tarjeta de Monitoreo y Cálculo Reactivo en Vivo -->
        <div class="live-preview-card" id="livePreviewCard">
          <div class="preview-badge-status pending" id="previewBadge">
            PENDIENTE DE NOTAS
          </div>

          <div class="big-average-display pending" id="previewAverage">
            —
          </div>

          <div class="preview-scale-label">PROMEDIO FINAL PONDERADO</div>

          <!-- Escala Visual 0 a 20 -->
          <div class="scale-wrapper">
            <div class="scale-track">
              <div class="scale-fill" id="previewScaleFill" style="width: 0%;"></div>
            </div>
            <div class="scale-marks">
              <span>0</span>
              <span class="scale-cutoff-indicator">▲ 11 (Corte Aprobatorio)</span>
              <span>20</span>
            </div>
          </div>

          <!-- Fórmula desglosada -->
          <div class="formula-box" id="previewFormula">
            Ingresa las 3 calificaciones para ver el resultado en vivo
          </div>
        </div>
      </section>

      <!-- Tabla de Estudiantes y Calificaciones -->
      <section class="table-section">
        <div class="table-header-controls">
          <div>
            <h2 style="font-size: 1.35rem; font-weight: 700;">Listado General de Estudiantes</h2>
            <p style="font-size: 0.85rem; color: var(--text-secondary);">Registro oficial de calificaciones en Supabase. Haz clic en las cabeceras para ordenar.</p>
          </div>

          <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
            <!-- Buscador -->
            <div class="search-box">
              <span class="search-icon">🔍</span>
              <input 
                type="text" 
                id="searchStudentInput" 
                class="search-input" 
                placeholder="Buscar por código o nombre..." 
                value="${searchQuery}" 
              />
            </div>

            <!-- Filtros -->
            <div class="filter-tabs">
              <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" data-filter="all">
                Todos (${total})
              </button>
              <button class="filter-btn ${currentFilter === 'approved' ? 'active' : ''}" data-filter="approved">
                Aprobados (${aprobados})
              </button>
              <button class="filter-btn ${currentFilter === 'failed' ? 'active' : ''}" data-filter="failed">
                Desaprobados (${desaprobados})
              </button>
            </div>
          </div>
        </div>

        <!-- Tabla -->
        <div class="table-wrapper">
          <div id="tableContainer">
            ${renderStudentsTable()}
          </div>
        </div>
      </section>
    </main>

    <!-- Firmas oficiales para Impresión -->
    <div class="print-only-signatures">
      <div>
        <div style="border-top: 1px solid #000; width: 220px; margin: 0 auto; padding-top: 6px; font-size: 9pt;">
          <strong>Firma del Docente Titular</strong><br>Doc. SIS224 Lenguajes de Programación
        </div>
      </div>
      <div>
        <div style="border-top: 1px solid #000; width: 220px; margin: 0 auto; padding-top: 6px; font-size: 9pt;">
          <strong>Dirección de Escuela Profesional</strong><br>Ingeniería de Sistemas
        </div>
      </div>
    </div>

    <!-- Modal 1: Script SQL para Supabase -->
    <div id="modalSql" class="modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <h3 style="font-size: 1.15rem; font-weight: 700;">📜 Script SQL para tu Base de Datos Supabase</h3>
          <button class="modal-close" id="btnCloseSqlModal">&times;</button>
        </div>
        <p style="font-size: 0.88rem; color: var(--text-secondary); line-height: 1.5;">
          Script ejecutado para la tabla <code>public.estudiantes</code> con políticas RLS de lectura, inserción, actualización y eliminación:
        </p>

        <div class="code-container">
          <code id="sqlScriptDisplay">${SQL_SETUP_SCRIPT}</code>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
          <button id="btnCopySqlScript" class="btn btn-primary">📋 Copiar Script SQL</button>
          <button id="btnCloseSqlModalBtn" class="btn btn-secondary">Cerrar</button>
        </div>
      </div>
    </div>

    <!-- Modal 2: Configuración de Conexión Supabase -->
    <div id="modalConfig" class="modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <h3 style="font-size: 1.15rem; font-weight: 700;">⚙️ Configurar Conexión a Supabase</h3>
          <button class="modal-close" id="btnCloseConfigModal">&times;</button>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 1.25rem;">
          Credenciales activas cargadas desde <code>.env</code> o almacenamiento local:
        </p>

        <div class="form-group" style="margin-bottom: 1rem;">
          <label class="form-label" for="cfgUrl">Supabase Project URL:</label>
          <input 
            type="text" 
            id="cfgUrl" 
            class="form-input" 
            placeholder="https://xyzabcdefg.supabase.co" 
            value="${creds.url || ''}" 
          />
        </div>

        <div class="form-group" style="margin-bottom: 1.25rem;">
          <label class="form-label" for="cfgKey">Supabase Anon Key (Public):</label>
          <input 
            type="password" 
            id="cfgKey" 
            class="form-input" 
            placeholder="eyJhbGciOiJIUzI1NiIsIn..." 
            value="${creds.key || ''}" 
          />
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; flex-wrap: wrap;">
          <button id="btnSaveConfig" class="btn btn-primary">Guardar y Probar Conexión</button>
          <button id="btnClearConfig" class="btn btn-secondary">Limpiar Guardadas</button>
          <button id="btnCloseConfigModalBtn" class="btn btn-secondary">Cerrar</button>
        </div>
      </div>
    </div>

    <!-- Modal 3: Confirmación de Eliminación -->
    <div id="modalDelete" class="modal-backdrop">
      <div class="modal-card" style="max-width: 450px;">
        <div class="modal-header">
          <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--failed-color);">🗑️ Confirmar Eliminación</h3>
          <button class="modal-close" id="btnCloseDeleteModal">&times;</button>
        </div>
        <p style="font-size: 0.9rem; color: var(--text-main); margin-bottom: 1rem;" id="deleteModalMessage">
          ¿Estás seguro de eliminar a este estudiante?
        </p>
        <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.5rem;">
          Esta acción eliminará el registro permanentemente de la base de datos de Supabase.
        </p>
        <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
          <button id="btnCancelDelete" class="btn btn-secondary">Cancelar</button>
          <button id="btnConfirmDelete" class="btn btn-outline-danger" style="background: var(--failed-bg); font-weight: 700;">
            Sí, Eliminar de Supabase
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="site-footer">
      <div class="container">
        <p>Sistema de Calificaciones • SIS224 Lenguajes de Programación • Conectado a Supabase PostgreSQL</p>
      </div>
    </footer>
  `;

  attachEventHandlers();
  updateLiveGradeCalculation();
}

/**
 * Renderiza las filas de la tabla de estudiantes con ordenación dinámica
 */
function renderStudentsTable() {
  // Orden global de ranking para calcular las posiciones reales
  const sortedGlobal = [...estudiantes].sort((a, b) => parseFloat(b.promedio) - parseFloat(a.promedio));

  // Filtrado
  let filtered = [...estudiantes];

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(e => 
      e.codigo.toLowerCase().includes(q) ||
      e.nombres.toLowerCase().includes(q) ||
      e.apellidos.toLowerCase().includes(q) ||
      (e.curso && e.curso.toLowerCase().includes(q))
    );
  }

  if (currentFilter === 'approved') {
    filtered = filtered.filter(e => e.condicion === 'APROBADO');
  } else if (currentFilter === 'failed') {
    filtered = filtered.filter(e => e.condicion === 'DESAPROBADO');
  }

  // Ordenación por columna
  filtered.sort((a, b) => {
    let valA, valB;
    if (sortField === 'puesto') {
      valA = sortedGlobal.findIndex(e => e.id === a.id);
      valB = sortedGlobal.findIndex(e => e.id === b.id);
    } else if (sortField === 'codigo') {
      valA = a.codigo.toLowerCase();
      valB = b.codigo.toLowerCase();
    } else if (sortField === 'estudiante') {
      valA = `${a.apellidos} ${a.nombres}`.toLowerCase();
      valB = `${b.apellidos} ${b.nombres}`.toLowerCase();
    } else if (['nota1', 'nota2', 'nota3', 'promedio'].includes(sortField)) {
      valA = parseFloat(a[sortField]);
      valB = parseFloat(b[sortField]);
    } else if (sortField === 'condicion') {
      valA = a.condicion;
      valB = b.condicion;
    } else {
      valA = parseFloat(a.promedio);
      valB = parseFloat(b.promedio);
    }

    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  if (filtered.length === 0) {
    return `
      <div class="empty-table-state">
        <div class="empty-icon">📭</div>
        <p style="font-weight: 600; font-size: 1.1rem; color: var(--text-main);">No se encontraron estudiantes</p>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem;">
          ${searchQuery ? 'Prueba con otro término de búsqueda o limpia el filtro.' : 'Usa el formulario arriba para registrar el primer estudiante.'}
        </p>
      </div>
    `;
  }

  const getSortIcon = (field) => {
    if (sortField !== field) return '<span class="sort-icon">⇅</span>';
    return sortDirection === 'asc' ? '<span class="sort-icon">▲</span>' : '<span class="sort-icon">▼</span>';
  };

  return `
    <table class="students-table">
      <thead>
        <tr>
          <th class="sortable-th ${sortField === 'puesto' ? 'active-sort' : ''}" data-sort="puesto" style="text-align: center;">
            Puesto ${getSortIcon('puesto')}
          </th>
          <th class="sortable-th ${sortField === 'codigo' ? 'active-sort' : ''}" data-sort="codigo">
            Código ${getSortIcon('codigo')}
          </th>
          <th class="sortable-th ${sortField === 'estudiante' ? 'active-sort' : ''}" data-sort="estudiante">
            Estudiante / Curso ${getSortIcon('estudiante')}
          </th>
          <th class="sortable-th ${sortField === 'nota1' ? 'active-sort' : ''}" data-sort="nota1" style="text-align: center;">
            Nota 1 ${getSortIcon('nota1')}
          </th>
          <th class="sortable-th ${sortField === 'nota2' ? 'active-sort' : ''}" data-sort="nota2" style="text-align: center;">
            Nota 2 ${getSortIcon('nota2')}
          </th>
          <th class="sortable-th ${sortField === 'nota3' ? 'active-sort' : ''}" data-sort="nota3" style="text-align: center;">
            Nota 3 ${getSortIcon('nota3')}
          </th>
          <th class="sortable-th ${sortField === 'promedio' ? 'active-sort' : ''}" data-sort="promedio" style="text-align: center;">
            Promedio ${getSortIcon('promedio')}
          </th>
          <th class="sortable-th ${sortField === 'condicion' ? 'active-sort' : ''}" data-sort="condicion" style="text-align: center;">
            Condición ${getSortIcon('condicion')}
          </th>
          <th style="text-align: right;">Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(st => {
          const isApproved = st.condicion === 'APROBADO';
          const promNum = parseFloat(st.promedio).toFixed(2);
          const rankPos = sortedGlobal.findIndex(e => e.id === st.id) + 1;
          const rankHtml = rankPos === 1
            ? `<span class="rank-badge gold">🥇 1° Puesto</span>`
            : rankPos === 2
            ? `<span class="rank-badge silver">🥈 2° Puesto</span>`
            : rankPos === 3
            ? `<span class="rank-badge bronze">🥉 3° Puesto</span>`
            : `<span class="rank-badge normal">${rankPos}°</span>`;

          return `
            <tr>
              <td style="text-align: center;">${rankHtml}</td>
              <td class="code-cell">${st.codigo}</td>
              <td>
                <div class="student-name-cell">
                  <span class="student-fullname">${st.apellidos}, ${st.nombres}</span>
                  <span class="student-course">${st.curso || 'Lenguajes de Programación'}</span>
                </div>
              </td>
              <td style="text-align: center;" class="grade-val">${parseFloat(st.nota1).toFixed(1)}</td>
              <td style="text-align: center;" class="grade-val">${parseFloat(st.nota2).toFixed(1)}</td>
              <td style="text-align: center;" class="grade-val">${parseFloat(st.nota3).toFixed(1)}</td>
              <td style="text-align: center;">
                <span class="avg-pill ${isApproved ? 'approved' : 'failed'}">
                  ${promNum}
                </span>
              </td>
              <td style="text-align: center;">
                <span class="condition-tag ${isApproved ? 'approved' : 'failed'}">
                  ${isApproved ? '✓ APROBADO' : '✕ DESAPROBADO'}
                </span>
              </td>
              <td style="text-align: right;">
                <div class="table-actions" style="justify-content: flex-end;">
                  <button class="btn btn-outline-edit btn-edit-student" data-id="${st.id}" title="Editar calificaciones">
                    ✏️ Editar
                  </button>
                  <button class="btn btn-outline-danger btn-delete-student" data-id="${st.id}" data-name="${st.nombres} ${st.apellidos}" data-code="${st.codigo}" title="Eliminar registro">
                    🗑️ Borrar
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

/**
 * Actualiza la tarjeta reactiva de cálculo en tiempo real
 */
function updateLiveGradeCalculation() {
  const n1 = document.getElementById('inputNota1')?.value;
  const n2 = document.getElementById('inputNota2')?.value;
  const n3 = document.getElementById('inputNota3')?.value;

  const card = document.getElementById('livePreviewCard');
  const badge = document.getElementById('previewBadge');
  const avgDisplay = document.getElementById('previewAverage');
  const fill = document.getElementById('previewScaleFill');
  const formula = document.getElementById('previewFormula');

  if (!card || !badge || !avgDisplay || !fill || !formula) return;

  const result = calculateGradeDetails(n1, n2, n3);

  if (!result.isValid) {
    card.className = 'live-preview-card';
    badge.className = 'preview-badge-status pending';
    badge.innerText = 'PENDIENTE DE NOTAS';
    avgDisplay.className = 'big-average-display pending';
    avgDisplay.innerText = '—';
    fill.style.width = '0%';
    formula.innerText = result.formulaText;
    return;
  }

  const isApproved = result.condicion === 'APROBADO';

  card.className = `live-preview-card ${isApproved ? 'approved' : 'failed'}`;
  badge.className = `preview-badge-status ${isApproved ? 'approved' : 'failed'}`;
  badge.innerText = isApproved ? '✓ APROBADO' : '✕ DESAPROBADO';

  avgDisplay.className = `big-average-display ${isApproved ? 'approved' : 'failed'}`;
  avgDisplay.innerText = result.promedioFormatted;

  fill.className = `scale-fill ${isApproved ? 'approved' : 'failed'}`;
  fill.style.width = `${result.fillPercentage}%`;

  formula.innerText = result.formulaText;
}

/**
 * Vincula todos los escuchadores de eventos
 */
function attachEventHandlers() {
  // Botones de Exportación e Impresión
  const btnExportCsv = document.getElementById('btnExportCsv');
  btnExportCsv?.addEventListener('click', exportToCsv);

  const btnPrintReport = document.getElementById('btnPrintReport');
  btnPrintReport?.addEventListener('click', printReport);

  const btnSyncData = document.getElementById('btnSyncData');
  btnSyncData?.addEventListener('click', async () => {
    btnSyncData.disabled = true;
    btnSyncData.innerText = 'Sincronizando...';
    await checkConnection();
    await reloadData();
    renderApp();
    showToast('¡Datos sincronizados con Supabase!', 'success');
  });

  // Inputs de notas: actualización en vivo del cálculo mientras el usuario teclea
  ['inputNota1', 'inputNota2', 'inputNota3'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
      const val = parseFloat(el.value);
      if (!isNaN(val) && (val < 0 || val > 20)) {
        el.classList.add('invalid');
      } else {
        el.classList.remove('invalid');
      }
      updateLiveGradeCalculation();
    });
  });

  // Enviar formulario (Crear o Actualizar)
  const form = document.getElementById('studentGradeForm');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const codigo = document.getElementById('inputCodigo')?.value.trim();
    const curso = document.getElementById('inputCurso')?.value.trim() || 'Lenguajes de Programación';
    const nombres = document.getElementById('inputNombres')?.value.trim();
    const apellidos = document.getElementById('inputApellidos')?.value.trim();
    const nota1 = parseFloat(document.getElementById('inputNota1')?.value);
    const nota2 = parseFloat(document.getElementById('inputNota2')?.value);
    const nota3 = parseFloat(document.getElementById('inputNota3')?.value);

    // Validaciones estrictas
    if (!codigo || !nombres || !apellidos) {
      showToast('Por favor completa todos los campos del estudiante.', 'error');
      return;
    }

    if (isNaN(nota1) || isNaN(nota2) || isNaN(nota3) || 
        nota1 < 0 || nota1 > 20 || 
        nota2 < 0 || nota2 > 20 || 
        nota3 < 0 || nota3 > 20) {
      showToast('Las 3 calificaciones deben ser números válidos entre 0 y 20.', 'error');
      return;
    }

    const calc = calculateGradeDetails(nota1, nota2, nota3);
    const payload = {
      codigo,
      curso,
      nombres,
      apellidos,
      nota1,
      nota2,
      nota3,
      promedio: calc.promedio,
      condicion: calc.condicion,
    };

    const submitBtn = document.getElementById('btnSubmitForm');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = 'Guardando en Supabase...';
    }

    try {
      if (editingStudentId) {
        // Actualización
        await updateEstudiante(editingStudentId, payload);
        showToast(`¡Estudiante ${nombres} ${apellidos} actualizado con éxito!`, 'success');
        editingStudentId = null;
      } else {
        // Creación
        await createEstudiante(payload);
        showToast(`¡Estudiante ${nombres} registrado (${calc.condicion}) en Supabase!`, 'success');
      }

      // Recargar lista y limpiar
      await reloadData();
      renderApp();
      resetForm();
    } catch (err) {
      showToast('Error: ' + err.message, 'error', 4500);
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = editingStudentId ? '💾 Actualizar Estudiante' : '💾 Guardar y Calcular';
      }
    }
  });

  // Botón Limpiar formulario
  const btnReset = document.getElementById('btnResetForm');
  btnReset?.addEventListener('click', () => {
    editingStudentId = null;
    resetForm();
    showToast('Formulario restablecido.');
  });

  // Buscador
  const searchInput = document.getElementById('searchStudentInput');
  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    updateTableOnly();
  });

  // Filtros (Todos, Aprobados, Desaprobados)
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter') || 'all';
      updateTableOnly();
    });
  });

  // Delegación de eventos en tabla (Editar / Eliminar / Ordenar)
  const tableContainer = document.getElementById('tableContainer');
  tableContainer?.addEventListener('click', async (e) => {
    // Ordenación por cabecera
    const sortTh = e.target.closest('.sortable-th');
    if (sortTh) {
      const field = sortTh.getAttribute('data-sort');
      if (sortField === field) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortField = field;
        sortDirection = ['promedio', 'puesto', 'nota1', 'nota2', 'nota3'].includes(field) ? 'desc' : 'asc';
      }
      updateTableOnly();
      return;
    }

    // Botón Editar
    const editBtn = e.target.closest('.btn-edit-student');
    if (editBtn) {
      const id = editBtn.getAttribute('data-id');
      const student = estudiantes.find(st => st.id === id);
      if (student) {
        editingStudentId = id;
        loadStudentIntoForm(student);
        window.scrollTo({ top: 120, behavior: 'smooth' });
        showToast(`Editando calificaciones de ${student.nombres}...`);
      }
      return;
    }

    // Botón Eliminar -> Abre Modal de Confirmación
    const deleteBtn = e.target.closest('.btn-delete-student');
    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-id');
      const name = deleteBtn.getAttribute('data-name');
      const code = deleteBtn.getAttribute('data-code');
      studentPendingDelete = { id, name, code };

      const modalDelete = document.getElementById('modalDelete');
      const deleteMsg = document.getElementById('deleteModalMessage');
      if (deleteMsg) {
        deleteMsg.innerHTML = `¿Estás seguro de que deseas eliminar el registro de <strong>${name}</strong> (Código: <code>${code}</code>)?`;
      }
      modalDelete?.classList.add('open');
    }
  });

  // Modales
  setupModalHandlers();
}

/**
 * Carga datos de un estudiante en el formulario para editar
 */
function loadStudentIntoForm(st) {
  const formHeader = document.getElementById('formHeaderTitle');
  const inputCodigo = document.getElementById('inputCodigo');
  const inputCurso = document.getElementById('inputCurso');
  const inputNombres = document.getElementById('inputNombres');
  const inputApellidos = document.getElementById('inputApellidos');
  const inputNota1 = document.getElementById('inputNota1');
  const inputNota2 = document.getElementById('inputNota2');
  const inputNota3 = document.getElementById('inputNota3');
  const submitBtn = document.getElementById('btnSubmitForm');

  if (formHeader) formHeader.innerHTML = `<span>✏️</span> Editando a: ${st.nombres} ${st.apellidos}`;
  if (inputCodigo) inputCodigo.value = st.codigo;
  if (inputCurso) inputCurso.value = st.curso || 'Lenguajes de Programación';
  if (inputNombres) inputNombres.value = st.nombres;
  if (inputApellidos) inputApellidos.value = st.apellidos;
  if (inputNota1) inputNota1.value = st.nota1;
  if (inputNota2) inputNota2.value = st.nota2;
  if (inputNota3) inputNota3.value = st.nota3;

  if (submitBtn) submitBtn.innerText = '💾 Actualizar Estudiante';

  updateLiveGradeCalculation();
}

/**
 * Limpia el formulario
 */
function resetForm() {
  const form = document.getElementById('studentGradeForm');
  form?.reset();
  const formHeader = document.getElementById('formHeaderTitle');
  if (formHeader) formHeader.innerHTML = `<span>📝</span> Registrar Nuevo Estudiante`;
  const submitBtn = document.getElementById('btnSubmitForm');
  if (submitBtn) submitBtn.innerText = '💾 Guardar y Calcular';
  editingStudentId = null;
  updateLiveGradeCalculation();
}

/**
 * Actualiza solo el contenido HTML de la tabla sin re-renderizar toda la página
 */
function updateTableOnly() {
  const container = document.getElementById('tableContainer');
  if (container) {
    container.innerHTML = renderStudentsTable();
  }
}

/**
 * Configuración de modales de SQL, Credenciales y Confirmación de Eliminación
 */
function setupModalHandlers() {
  // Modal SQL
  const modalSql = document.getElementById('modalSql');
  const btnOpenSqlModal = document.getElementById('btnOpenSqlModal');
  const btnCloseSqlModal = document.getElementById('btnCloseSqlModal');
  const btnCloseSqlModalBtn = document.getElementById('btnCloseSqlModalBtn');
  const btnCopySqlScript = document.getElementById('btnCopySqlScript');

  btnOpenSqlModal?.addEventListener('click', () => modalSql?.classList.add('open'));
  btnCloseSqlModal?.addEventListener('click', () => modalSql?.classList.remove('open'));
  btnCloseSqlModalBtn?.addEventListener('click', () => modalSql?.classList.remove('open'));

  btnCopySqlScript?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(SQL_SETUP_SCRIPT);
      showToast('¡Script SQL copiado al portapapeles!', 'success');
    } catch {
      showToast('No se pudo copiar el texto.', 'error');
    }
  });

  // Modal Conexión
  const modalConfig = document.getElementById('modalConfig');
  const btnOpenConfigModal = document.getElementById('btnOpenConfigModal');
  const btnCloseConfigModal = document.getElementById('btnCloseConfigModal');
  const btnCloseConfigModalBtn = document.getElementById('btnCloseConfigModalBtn');
  const btnSaveConfig = document.getElementById('btnSaveConfig');
  const btnClearConfig = document.getElementById('btnClearConfig');

  btnOpenConfigModal?.addEventListener('click', () => modalConfig?.classList.add('open'));
  btnCloseConfigModal?.addEventListener('click', () => modalConfig?.classList.remove('open'));
  btnCloseConfigModalBtn?.addEventListener('click', () => modalConfig?.classList.remove('open'));

  btnSaveConfig?.addEventListener('click', async () => {
    const url = document.getElementById('cfgUrl')?.value.trim();
    const key = document.getElementById('cfgKey')?.value.trim();
    if (!url || !key) {
      showToast('Por favor introduce URL y Anon Key.', 'error');
      return;
    }
    saveLocalCredentials(url, key);
    showToast('Credenciales guardadas. Probando conexión...');
    modalConfig?.classList.remove('open');
    await checkConnection();
    await reloadData();
    renderApp();
  });

  btnClearConfig?.addEventListener('click', async () => {
    clearLocalCredentials();
    showToast('Credenciales de navegador eliminadas.');
    modalConfig?.classList.remove('open');
    await checkConnection();
    await reloadData();
    renderApp();
  });

  // Modal Eliminación
  const modalDelete = document.getElementById('modalDelete');
  const btnCloseDeleteModal = document.getElementById('btnCloseDeleteModal');
  const btnCancelDelete = document.getElementById('btnCancelDelete');
  const btnConfirmDelete = document.getElementById('btnConfirmDelete');

  const closeDeleteModal = () => {
    studentPendingDelete = null;
    modalDelete?.classList.remove('open');
  };

  btnCloseDeleteModal?.addEventListener('click', closeDeleteModal);
  btnCancelDelete?.addEventListener('click', closeDeleteModal);

  btnConfirmDelete?.addEventListener('click', async () => {
    if (!studentPendingDelete) return;
    const { id, name } = studentPendingDelete;
    btnConfirmDelete.disabled = true;
    btnConfirmDelete.innerText = 'Eliminando...';

    try {
      await deleteEstudiante(id);
      showToast(`Estudiante ${name} eliminado con éxito de Supabase.`, 'success');
      closeDeleteModal();
      await reloadData();
      renderApp();
    } catch (err) {
      showToast('Error al eliminar: ' + err.message, 'error');
    } finally {
      btnConfirmDelete.disabled = false;
      btnConfirmDelete.innerText = 'Sí, Eliminar de Supabase';
    }
  });
}

/**
 * Comprueba conexión con Supabase
 */
async function checkConnection() {
  try {
    connectionStatus = await testSupabaseConnection();
  } catch (err) {
    connectionStatus = {
      connected: false,
      status: 'error',
      message: err.message,
      latency: 0,
    };
  }
}

/**
 * Recarga los datos de estudiantes desde Supabase o almacenamiento local
 */
async function reloadData() {
  try {
    const res = await getEstudiantes();
    estudiantes = res.data || [];
  } catch (err) {
    console.error('Error cargando estudiantes:', err);
    showToast('Error cargando datos: ' + err.message, 'error');
  }
}

/**
 * Inicialización de la aplicación
 */
async function init() {
  await checkConnection();
  await reloadData();
  renderApp();

  // Iniciar suscripción Realtime a la base de datos de Supabase
  if (!realtimeChannel) {
    realtimeChannel = subscribeToEstudiantesChanges(async (payload) => {
      console.log('Evento Realtime recibido:', payload.eventType);
      await reloadData();
      renderApp();
      showToast('⚡ Sincronizado en tiempo real con Supabase', 'info', 2000);
    });
  }
}

init();
