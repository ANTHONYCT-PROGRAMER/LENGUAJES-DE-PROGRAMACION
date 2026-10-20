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
  SQL_SETUP_SCRIPT
} from './supabase.js';

// Estado global de la aplicación
let estudiantes = [];
let editingStudentId = null;
let searchQuery = '';
let currentFilter = 'all'; // 'all' | 'approved' | 'failed'
let connectionStatus = { connected: false, status: 'checking', message: 'Comprobando...' };

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

  app.innerHTML = `
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
            <p>Registra notas de 0 a 20 con cálculo automático de promedio y condición aprobatoria (≥ 11).</p>
          </div>
        </div>

        <!-- Indicadores Clave (KPIs) -->
        <div class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Total Alumnos <span>👥</span></div>
            <div class="kpi-value">${total}</div>
            <div class="kpi-subtext">Estudiantes evaluados</div>
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
        </div>
      </section>

      <!-- Grid Principal: Formulario y Monitor Reactivo de Calificación -->
      <section class="layout-grid">
        <!-- Formulario de Registro / Edición -->
        <div class="panel">
          <h2 class="panel-title" id="formHeaderTitle">
            <span>📝</span> ${editingStudentId ? 'Editar Calificaciones del Estudiante' : 'Registrar Nuevo Estudiante'}
          </h2>
          <p class="panel-desc">
            ${editingStudentId ? 'Modifica los datos o calificaciones y guarda los cambios.' : 'Ingresa el código del alumno, sus nombres y las 3 notas reglamentarias.'}
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
                  placeholder="Ej: SIS-2024-010" 
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
              <span class="scale-cutoff-indicator">▲ 11 (Corte)</span>
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
            <p style="font-size: 0.85rem; color: var(--text-secondary);">Registro oficial de promedios y condición académica.</p>
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

    <!-- Modal 1: Script SQL para Supabase -->
    <div id="modalSql" class="modal-backdrop">
      <div class="modal-card">
        <div class="modal-header">
          <h3 style="font-size: 1.15rem; font-weight: 700;">📜 Script SQL para tu Base de Datos Supabase</h3>
          <button class="modal-close" id="btnCloseSqlModal">&times;</button>
        </div>
        <p style="font-size: 0.88rem; color: var(--text-secondary); line-height: 1.5;">
          Para que tu proyecto en Supabase guarde los datos en la nube, ve a tu panel de Supabase $\rightarrow$ 
          <strong>SQL Editor</strong> $\rightarrow$ pega el siguiente script y haz clic en <strong>RUN</strong>:
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
          Ingresa tus credenciales directamente aquí para conectar sin reiniciar la terminal. También puedes configurarlas en tu archivo <code>.env</code>.
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
 * Renderiza las filas de la tabla de estudiantes
 */
function renderStudentsTable() {
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

  return `
    <table class="students-table">
      <thead>
        <tr>
          <th>Código</th>
          <th>Estudiante / Curso</th>
          <th style="text-align: center;">Nota 1</th>
          <th style="text-align: center;">Nota 2</th>
          <th style="text-align: center;">Nota 3</th>
          <th style="text-align: center;">Promedio</th>
          <th style="text-align: center;">Condición</th>
          <th style="text-align: right;">Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(st => {
          const isApproved = st.condicion === 'APROBADO';
          const promNum = parseFloat(st.promedio).toFixed(2);
          return `
            <tr>
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
                  <button class="btn btn-outline-danger btn-delete-student" data-id="${st.id}" data-name="${st.nombres} ${st.apellidos}" title="Eliminar registro">
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
  // Inputs de notas: actualización en vivo del cálculo mientras el usuario teclea
  ['inputNota1', 'inputNota2', 'inputNota3'].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener('input', () => {
      // Validar visualmente si excede 0-20
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
        showToast(`¡Estudiante ${nombres} registrado (${calc.condicion})!`, 'success');
      }

      // Recargar lista y limpiar
      await reloadData();
      resetForm();
    } catch (err) {
      showToast('Error: ' + err.message, 'error', 4500);
    } finally {
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

  // Delegación de eventos en tabla (Editar / Eliminar)
  const tableContainer = document.getElementById('tableContainer');
  tableContainer?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('.btn-edit-student');
    const deleteBtn = e.target.closest('.btn-delete-student');

    if (editBtn) {
      const id = editBtn.getAttribute('data-id');
      const student = estudiantes.find(st => st.id === id);
      if (student) {
        editingStudentId = id;
        loadStudentIntoForm(student);
        window.scrollTo({ top: 120, behavior: 'smooth' });
        showToast(`Editando calificaciones de ${student.nombres}...`);
      }
    }

    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-id');
      const name = deleteBtn.getAttribute('data-name');
      const confirmed = window.confirm(`¿Estás seguro de eliminar el registro de ${name}?`);
      if (confirmed) {
        try {
          await deleteEstudiante(id);
          showToast(`Registro de ${name} eliminado con éxito.`, 'success');
          await reloadData();
        } catch (err) {
          showToast('Error al eliminar: ' + err.message, 'error');
        }
      }
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
 * Configuración de modales de SQL y Credenciales
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
    showToast('Credenciales guardadas en navegador. Probando conexión...');
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
}

init();
