import _ from 'underscore';
import {
  User,
  ApiWrapper,
  Dimensions,
  DimensionsStorage,
  DimensionsModel,
} from 'sygic-geotab-utils';

geotab.addin.mygeotabSygicPage = function (api, state) {
  'use strict';
  const addinDataGuid = 'ajk3ZmUzNmQtYjNlYS0yMGI';

  var elAddin = document.getElementById('mygeotabSygicPage');
  
  // Configuración
  const ITEMS_PER_PAGE = 30;
  let currentIndex = 0;
  let isLoading = false;
  let allDataLoaded = false;
  let observer = null;
  
  // Datos cacheados
  let allDevices = [];
  let allDimensions = {};
  let currentUser = null;
  let storage = null;
  let groupMap = {};

  let geotabApi = ApiWrapper(api);

  // Template más simple para mejor rendimiento
  const templateString = `
  <li class='<%= user.canView ? "" : "hidden" %>'>
  <div class='g-col checkmateListBuilderRow sygic-vehicle' style='padding-left: 0px' data-device-id='<%= vehicle.id %>'>
    <div class='g-row'>
        <div class='g-main g-main-col g-main_wider'>
          <div class='g-name'>
            <span class='ellipsis'><%= vehicle.name %></span>
          </div>
          <div class='g-comment'>
            <div class='secondaryData ellipsis'><%= vehicle_groups_string %></div>
          </div>
          <div class='g-comment vehicle-dimensions-comment'>
            <div class='secondaryData ellipsis'><%= vehicle_dimensions_string %></div>
          </div>
        </div>
      <div class='g-ctrl'>
        <a href='#' class='geotabButton geotabButton-empty sygic-edit-dimensions<%= user.canModify ? "" : " hidden" %>'>
          <svg class='svgIcon geotabButtonIcons'><use xlink:href='#geo-pencil-icon'>
            <svg viewBox='0 0 32 32' id='geo-pencil-icon'><path d='M7.79 29.124l1.878-1.915-4.919-4.919-1.915 1.915v2.253h2.703v2.666H7.79zm10.927-19.45q0-.45-.45-.45-.189 0-.339.15L6.551 20.714q-.15.15-.15.375 0 .45.488.45.188 0 .338-.15l11.377-11.34q.113-.15.113-.375zM17.59 5.657l8.711 8.71L8.88 31.828H.17V23.08zm14.306 2.027q0 1.09-.751 1.878l-3.492 3.492-8.711-8.749L22.434.851q.75-.789 1.877-.789 1.09 0 1.915.789l4.919 4.918q.75.827.75 1.915z'></path></svg>
          </use></svg>
        </a>
      </div>
    </div>
    <div class='g-row hidden sygic-vehicle-dimensions-form'>
      <fieldset class='geotabFieldset sygic-vehicle-dimensions-fieldset' style='background-color: transparent'>
        <% _.each(vehicle_dimensions, dimension => { %>
            <%  if (dimension.key != "hazmat") { %>
              <%  let name = "sygic-truck-dimensions-" + dimension.key; %>
              <%  let value = dimension.value; %>
              <%  let label = dimension.label; %>
              <%  let options = dimension.options; %>
              <% if (options) { %>
               <div class='geotabField'>
                  <label for='<%= name %>'><%= label %></label>
                  <select name='<%= name %>' class='geotabFormEditField' >
                    <% _.each(options, (option, key)  => { %>
                      <option value='<%= key %>' <% if (value === key) { %> selected='selected' <% } %>  ><%= option %></option>
                    <% }) %>                   
                  </select>
               </div>
              <% } else { %>
                <div class='geotabField'>
                  <label for='<%= name %>'><%= label %></label>
                  <input type='number' step='0.1' name='<%= name %>' class='geotabFormEditField' value='<%= value %>' />
                </div>
              <% } %>
            <%  } %>
        <% }) %>
        <div data-name='hazmat-fields'>
            <% _.each(vehicle_hazmat, hazmat => { %>
              <%  let name = "sygic-truck-hazmat-" + hazmat.key; %>
              <% if (hazmat.key === "adr_tunnel") { %>
                 <div class='geotabField' <% if (!hazmat.visible) { %> hidden='hidden' <% } %> >
                  <label for='<%= name %>'><%= hazmat.label %></label>
                  <select name='<%= name %>' class='geotabFormEditField' >
                    <option></option>
                    <% _.each(hazmat.options, option => { %>
                      <option value='<%= option %>' <% if (hazmat.value === option) { %> selected='selected' <% } %>  ><%= option %></option>
                    <% }) %>                   
                  </select>
                </div>
              <% } else { %>
                <div class='geotabField'  <% if (!hazmat.visible) { %> hidden='hidden' <% } %> >
                  <label for='<%= name %>'><%= hazmat.label %></label>
                  <input type='checkbox' step='0.1' name='<%= name %>' class='geotabFormEditField' <% if (hazmat.value) { %> checked <% } %> />
                </div>
              <% } %>
            <% }) %>
        </div>
        <button class='geotabButton sygic-vehicle-dimensions-save' ><%= apply_changes %></button>
      </fieldset>
    </div>
  </div>
</li>
  `;

  // Template compilado una sola vez
  let compiledTemplate = null;

  function getCompiledTemplate() {
    if (!compiledTemplate) {
      compiledTemplate = _.template(templateString);
    }
    return compiledTemplate;
  }

  function getDimensionsString(viewModel) {
    let parts = [];
    for (const key in viewModel) {
      if (viewModel.hasOwnProperty(key)) {
        const model = viewModel[key];
        if (typeof model.value === 'number' || typeof model.value === 'string') {
          if (key === 'routing_type') {
            parts.push(`${model.label}: ${DimensionsModel.getRoutingTypeString(model.value, state)}`);
          } else {
            parts.push(`${model.label}: ${model.value}`);
          }
        }
      }
    }
    return parts.join(', ');
  }

  function createVehicleHTML(device) {
    let dimensionDetailsString = '';
    let viewModel;
    
    if (allDimensions[device.id]) {
      viewModel = allDimensions[device.id].getViewModelWithUnits(currentUser.isMetric, state);
      dimensionDetailsString = getDimensionsString(viewModel);
    } else {
      viewModel = DimensionsModel.getEmptyViewModel(currentUser.isMetric, state);
      dimensionDetailsString = 'Dimensions unset';
    }

    const dimensionsTemplateObject = Object.keys(viewModel)
      .filter(key => key !== 'hazmat')
      .map(key => ({
        value: viewModel[key].value,
        key: key,
        label: viewModel[key].label,
        options: viewModel[key].options,
      }));

    const hazmatTemplateObject = Object.keys(viewModel.hazmat.value).map(key => ({
      value: viewModel.hazmat.value[key].value,
      key: key,
      label: viewModel.hazmat.value[key].label,
      visible: viewModel.hazmat.value[key].visible,
      options: viewModel.hazmat.value[key].options,
    }));

    const vehicle_groups_string = device.groups.map(c => c.name || groupMap[c.id] || c.id).join(', ');
    
    return getCompiledTemplate()({
      vehicle: device,
      vehicle_dimensions_string: dimensionDetailsString,
      vehicle_groups_string: vehicle_groups_string,
      vehicle_dimensions: dimensionsTemplateObject,
      vehicle_hazmat: hazmatTemplateObject,
      user: currentUser,
      apply_changes: state.translate('Apply Changes'),
    });
  }

  function attachEventListenersToRow(row) {
    const deviceId = row.dataset.deviceId;
    const editAnchor = row.querySelector('.sygic-edit-dimensions');
    const form = row.querySelector('.sygic-vehicle-dimensions-form');
    const comment = row.querySelector('.vehicle-dimensions-comment');
    
    if (editAnchor) {
      editAnchor.onclick = (e) => {
        e.preventDefault();
        comment.classList.toggle('hidden');
        form.classList.toggle('hidden');
      };
    }

    const submitButton = row.querySelector('.sygic-vehicle-dimensions-save');
    if (submitButton) {
      submitButton.onclick = async () => {
        const fieldSet = row.querySelector('.sygic-vehicle-dimensions-fieldset');
        const dimensionsInputs = Dimensions.getInputValues(fieldSet);
        const dimensionsModel = DimensionsModel.getFromStringInputs(dimensionsInputs, currentUser.isMetric);
        
        let storedDimensions = await storage.getDimensionsModelAsync(deviceId);
        
        if (!storedDimensions) {
          await storage.addDimensionsAsync(dimensionsModel, deviceId);
        } else {
          try {
            await storage.setDimensionsAsync(dimensionsModel, storedDimensions.id, deviceId);
          } catch (e) { }
        }
        
        comment.classList.toggle('hidden');
        form.classList.toggle('hidden');
        const model = dimensionsModel.getViewModelWithUnits(currentUser.isMetric, state);
        comment.querySelector('.secondaryData').textContent = getDimensionsString(model);
        
        // Actualizar caché
        allDimensions[deviceId] = dimensionsModel;
      };
    }
  }

  function showLoading(show) {
    let loader = document.getElementById('sygic-loading-indicator');
    if (show) {
      if (!loader) {
        const vehicleList = document.getElementById('sygic-vehicle-list');
        vehicleList.insertAdjacentHTML('beforeend', `
          <li id="sygic-loading-indicator" style="text-align: center; padding: 20px; list-style: none;">
            <div class="sygic-spinner"></div>
            <span>Cargando vehículos...</span>
          </li>
        `);
      }
    } else if (loader) {
      loader.remove();
    }
  }

  function updateCounter() {
    let counter = document.getElementById('sygic-vehicle-counter');
    if (counter) {
      const loaded = Math.min(currentIndex, allDevices.length);
      counter.textContent = ` (${loaded} / ${allDevices.length})`;
    }
  }

  function loadMoreItems() {
    if (isLoading || allDataLoaded) return;
    
    isLoading = true;
    
    const endIndex = Math.min(currentIndex + ITEMS_PER_PAGE, allDevices.length);
    const itemsToRender = allDevices.slice(currentIndex, endIndex);
    
    if (itemsToRender.length === 0) {
      allDataLoaded = true;
      isLoading = false;
      showLoading(false);
      return;
    }

    // Usar requestAnimationFrame para no bloquear el UI
    requestAnimationFrame(() => {
      const vehicleList = document.getElementById('sygic-vehicle-list');
      const fragment = document.createDocumentFragment();
      const tempDiv = document.createElement('div');
      
      // Crear HTML en batch
      const htmlBatch = itemsToRender.map(device => createVehicleHTML(device)).join('');
      tempDiv.innerHTML = htmlBatch;
      
      // Mover elementos al fragment y attachar eventos
      while (tempDiv.firstElementChild) {
        const li = tempDiv.firstElementChild;
        const vehicleRow = li.querySelector('.sygic-vehicle');
        if (vehicleRow) {
          attachEventListenersToRow(vehicleRow);
        }
        fragment.appendChild(li);
      }
      
      // Insertar antes del loader
      const loader = document.getElementById('sygic-loading-indicator');
      if (loader) {
        vehicleList.insertBefore(fragment, loader);
      } else {
        vehicleList.appendChild(fragment);
      }
      
      currentIndex = endIndex;
      updateCounter();
      
      if (currentIndex >= allDevices.length) {
        allDataLoaded = true;
        showLoading(false);
      }
      
      isLoading = false;
    });
  }

  function setupScrollListener() {
    const container = document.querySelector('.checkmateListBuilder') || window;
    
    const handleScroll = _.throttle(() => {
      if (isLoading || allDataLoaded) return;
      
      const scrollElement = container === window ? document.documentElement : container;
      const scrollTop = container === window ? window.scrollY : container.scrollTop;
      const scrollHeight = scrollElement.scrollHeight;
      const clientHeight = container === window ? window.innerHeight : container.clientHeight;
      
      // Cargar más cuando estemos a 200px del final
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        loadMoreItems();
      }
    }, 100);
    
    container.addEventListener('scroll', handleScroll, { passive: true });
    
    // Guardar referencia para limpiar
    elAddin._scrollHandler = handleScroll;
    elAddin._scrollContainer = container;
  }

  function cleanupScrollListener() {
    if (elAddin._scrollHandler && elAddin._scrollContainer) {
      elAddin._scrollContainer.removeEventListener('scroll', elAddin._scrollHandler);
      elAddin._scrollHandler = null;
      elAddin._scrollContainer = null;
    }
  }

  async function loadInitialData() {
    showLoading(true);
    
    // Cargar todo en paralelo
    const [devices, groups, dimensionsData, session] = await Promise.all([
      geotabApi.callAsync('Get', {
        typeName: 'Device',
        search: { groups: state.getGroupFilter() },
      }),
      geotabApi.callAsync('Get', { typeName: 'Group' }),
      storage.getAllDimensionsModelsAsync(),
      geotabApi.getSessionAsync(),
    ]);

    // Crear mapa de grupos
    groupMap = {};
    groups.forEach(g => {
      groupMap[g.id] = g.name || g.id;
    });

    // Asignar nombres de grupos a dispositivos
    devices.forEach(device => {
      device.groups.forEach(group => {
        group.name = groupMap[group.id];
      });
    });

    allDevices = devices;
    allDimensions = dimensionsData;

    // Obtener usuario
    const [geotabUser, geotabClearances] = await Promise.all([
      geotabApi.callAsync('Get', {
        typeName: 'User',
        search: { name: session.userName },
      }),
      geotabApi.callAsync('Get', {
        typeName: 'Group',
        search: { id: 'groupSecurityId' },
      }),
    ]);

    currentUser = new User(geotabUser[0], geotabClearances);
  }

  function initializeUI() {
    const vehicleList = document.getElementById('sygic-vehicle-list');
    vehicleList.innerHTML = '';
    
    // Añadir contador al header
    const header = document.querySelector('.geotabPageHeader h1');
    let counter = document.getElementById('sygic-vehicle-counter');
    if (!counter) {
      counter = document.createElement('span');
      counter.id = 'sygic-vehicle-counter';
      counter.style.cssText = 'font-size: 14px; color: #666; margin-left: 10px; font-weight: normal;';
      header.appendChild(counter);
    }
    counter.textContent = ` (0 / ${allDevices.length})`;
    
    // Reset estado
    currentIndex = 0;
    isLoading = false;
    allDataLoaded = false;
    
    // Mostrar loading y cargar primeros items
    showLoading(true);
    loadMoreItems();
    
    // Setup scroll listener
    setupScrollListener();
  }

  function addStyles() {
    if (document.getElementById('sygic-lazy-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'sygic-lazy-styles';
    style.textContent = `
      .sygic-spinner {
        width: 24px;
        height: 24px;
        border: 3px solid #e0e0e0;
        border-top-color: #1a73e8;
        border-radius: 50%;
        animation: sygic-spin 0.8s linear infinite;
        margin: 0 auto 8px;
      }
      @keyframes sygic-spin {
        to { transform: rotate(360deg); }
      }
      #sygic-vehicle-list {
        padding: 0;
        margin: 0;
      }
    `;
    document.head.appendChild(style);
  }

  return {
    initialize: async function (freshApi, freshState, initializeCallback) {
      if (freshState.translate) {
        freshState.translate(elAddin || '');
      }
      addStyles();
      storage = new DimensionsStorage(geotabApi);
      initializeCallback();
    },

    focus: async function (freshApi, freshState) {
      elAddin.className = '';
      
      // Mostrar loading inmediatamente
      const vehicleList = document.getElementById('sygic-vehicle-list');
      vehicleList.innerHTML = `
        <li style="text-align: center; padding: 40px; list-style: none;">
          <div class="sygic-spinner"></div>
          <span>Cargando datos...</span>
        </li>
      `;
      
      try {
        await loadInitialData();
        initializeUI();
      } catch (error) {
        console.error('Error loading data:', error);
        vehicleList.innerHTML = `
          <li style="text-align: center; padding: 40px; color: red;">
            Error cargando datos. Por favor, recarga la página.
          </li>
        `;
      }
    },

    blur: function () {
      elAddin.className += ' hidden';
      cleanupScrollListener();
      
      // Reset
      currentIndex = 0;
      isLoading = false;
      allDataLoaded = false;
      allDevices = [];
      allDimensions = {};
      currentUser = null;
    },
  };
};