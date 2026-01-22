import _ from 'underscore';
import {
  User,
  ApiWrapper,
  Dimensions,
  DimensionsStorage,
  DimensionsModel,
} from 'sygic-geotab-utils';

/**
 * @returns {{initialize: Function, focus: Function, blur: Function}}
 */
geotab.addin.mygeotabSygicPage = function (api, state) {
  'use strict';
  const addinDataGuid = 'ajk3ZmUzNmQtYjNlYS0yMGI';

  // the root container
  var elAddin = document.getElementById('mygeotabSygicPage');
  
  // Configuración de lazy loading
  const ITEMS_PER_PAGE = 20;
  let currentPage = 0;
  let isLoading = false;
  let allDataLoaded = false;
  let cachedData = null;
  let observer = null;

  let templateString = `
  <li class='<%= user.canView ? '' : ' hidden' %>'>
  <div class='g-col checkmateListBuilderRow sygic-vehicle' style='padding-left: 0px'>
    <input type='hidden' class='sygic-vehicle-id' value=<%= vehicle.id %>>
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
        <a href='#' class='geotabButton geotabButton-empty sygic-edit-dimensions<%= user.canModify ? '' : ' hidden' %>'>
          <svg class='svgIcon geotabButtonIcons'><use xlink:href='#geo-pencil-icon'>
            <svg viewBox='0 0 32 32' id='geo-pencil-icon'><path d='M7.79 29.124l1.878-1.915-4.919-4.919-1.915 1.915v2.253h2.703v2.666H7.79zm10.927-19.45q0-.45-.45-.45-.189 0-.339.15L6.551 20.714q-.15.15-.15.375 0 .45.488.45.188 0 .338-.15l11.377-11.34q.113-.15.113-.375zM17.59 5.657l8.711 8.71L8.88 31.828H.17V23.08zm14.306 2.027q0 1.09-.751 1.878l-3.492 3.492-8.711-8.749L22.434.851q.75-.789 1.877-.789 1.09 0 1.915.789l4.919 4.918q.75.827.75 1.915z'></path></svg>
          </use></svg>
        </a>
      </div>
    </div>
    <div class='g-row hidden sygic-vehicle-dimensions-form'>
      <fieldset class='geotabFieldset sygic-vehicle-dimensions-fieldset' style='background-color: transparent'>
        <% _.each(vehicle_dimensions, dimension => { %>
            <%  if (dimension.key != 'hazmat') { %>
              <%  let name = 'sygic-truck-dimensions-' + dimension.key; %>
              <%  let value = dimension.value; %>
              <%  let label = dimension.label; %>
              <%  let options = dimension.options; %>
              <% if (options) { %>
               <div class='geotabField'>
                  <label for=<%= name %>><%= label %></label>
                  <select name=<%= name %> class='geotabFormEditField' >
                    <% _.each(options, (option, key)  => { %>
                      <option value=<%= key %> <% if (value === key) { %> selected='selected' <% } %>  ><%= option %></option>
                    <% }) %>                   
                  </select>
               </div>
              <% } else { %>
                <div class='geotabField'>
                  <label for=<%= name %>><%= label %></label>
                  <input type='number' step=0.1 name=<%= name %> class='geotabFormEditField' value=<%= value %> />
                </div>
              <% } %>
            <%  } %>
        <% }) %>
        <div data-name='hazmat-fields'>
            <% _.each(vehicle_hazmat, hazmat => { %>
              <%  let name = 'sygic-truck-hazmat-' + hazmat.key; %>
              <% if (hazmat.key === 'adr_tunnel') { %>
                 <div class='geotabField' <% if (!hazmat.visible) { %> hidden='hidden' <% } %> >
                  <label for=<%= name %>><%= hazmat.label %></label>
                  <select name=<%= name %> class='geotabFormEditField' >
                    <option></option>
                    <% _.each(hazmat.options, option => { %>
                      <option value=<%= option %> <% if (hazmat.value === option) { %> selected='selected' <% } %>  ><%= option %></option>
                    <% }) %>                   
                  </select>
                </div>
              <% } else { %>
                <div class='geotabField'  <% if (!hazmat.visible) { %> hidden='hidden' <% } %> >
                  <label for=<%= name %>><%= hazmat.label %></label>
                  <input type='checkbox' step=0.1 name=<%= name %> class='geotabFormEditField' <% if (hazmat.value) { %> checked <% } %> />
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

  // Template para el indicador de carga
  const loadingTemplate = `
    <li id="sygic-loading-indicator" class="sygic-loading">
      <div style="text-align: center; padding: 20px;">
        <div class="sygic-spinner"></div>
        <span>Loading more vehicles...</span>
      </div>
    </li>
  `;

  // Template para el sentinel (elemento observado para infinite scroll)
  const sentinelTemplate = `
    <li id="sygic-scroll-sentinel" style="height: 1px;"></li>
  `;

  let geotabApi = ApiWrapper(api);

  function getDimensionsString(viewModel) {
    let iterator = 0;
    let dimensionDetailsString = '';
    for (const key in viewModel) {
      if (viewModel.hasOwnProperty(key)) {
        const model = viewModel[key];
        if (typeof model.value === 'number' || typeof model.value === 'string') {
          if (iterator++ > 0) dimensionDetailsString += ', ';
          if (key === 'routing_type') {
            dimensionDetailsString += `${model.label}: ${DimensionsModel.getRoutingTypeString(model.value, state)}`;
          } else {
            dimensionDetailsString += `${model.label}: ${model.value}`;
          }
        }
      }
    }
    return dimensionDetailsString;
  }

  function createVehicleElement(device, dimensions, user) {
    let dimensionDetailsString = '';
    let viewModel = undefined;
    
    if (dimensions[device.id]) {
      viewModel = dimensions[device.id].getViewModelWithUnits(user.isMetric, state);
      dimensionDetailsString = getDimensionsString(viewModel);
    } else {
      viewModel = DimensionsModel.getEmptyViewModel(user.isMetric, state);
      dimensionDetailsString = 'Dimensions unset';
    }

    let dimensionsTemplateObject = Object.keys(viewModel).map(key => {
      if (key !== 'hazmat') {
        return {
          value: viewModel[key].value,
          key: key,
          label: viewModel[key].label,
          options: viewModel[key].options,
        };
      }
      return null;
    }).filter(Boolean);

    let hazmatTemplateObject = Object.keys(viewModel.hazmat.value).map(key => ({
      value: viewModel.hazmat.value[key].value,
      key: key,
      label: viewModel.hazmat.value[key].label,
      visible: viewModel.hazmat.value[key].visible,
      options: viewModel.hazmat.value[key].options,
    }));

    let vehicle_groups_string = device.groups.map((c) => c.name).join(', ');
    let template = _.template(templateString);
    
    return template({
      vehicle: device,
      vehicle_dimensions_string: dimensionDetailsString,
      vehicle_groups_string: vehicle_groups_string,
      vehicle_dimensions: dimensionsTemplateObject,
      vehicle_hazmat: hazmatTemplateObject,
      user: user,
      apply_changes: state.translate('Apply Changes'),
    });
  }

  function attachEventListeners(row, storage, user) {
    let deviceId = row.getElementsByClassName('sygic-vehicle-id')[0].value;
    let editAnchor = row.getElementsByClassName('sygic-edit-dimensions')[0];
    let form = row.getElementsByClassName('sygic-vehicle-dimensions-form')[0];
    let comment = row.getElementsByClassName('vehicle-dimensions-comment')[0];
    
    editAnchor.addEventListener('click', (event) => {
      event.preventDefault();
      comment.classList.toggle('hidden');
      form.classList.toggle('hidden');
    });

    let fieldSet = row.getElementsByClassName('sygic-vehicle-dimensions-fieldset')[0];
    let submitButton = row.getElementsByClassName('sygic-vehicle-dimensions-save')[0];
    
    submitButton.addEventListener('click', async (event) => {
      let dimensionsInputs = Dimensions.getInputValues(fieldSet);
      const dimensionsModel = DimensionsModel.getFromStringInputs(dimensionsInputs, user.isMetric);
      let storedDimensions = await storage.getDimensionsModelAsync(deviceId);
      
      if (!storedDimensions) {
        await storage.addDimensionsAsync(dimensionsModel, deviceId);
      } else {
        try {
          await storage.setDimensionsAsync(
            dimensionsModel,
            storedDimensions.id,
            deviceId
          );
        } catch (e) {
          // nothing here. It just fails for no reason.
        }
      }
      comment.classList.toggle('hidden');
      form.classList.toggle('hidden');
      const model = dimensionsModel.getViewModelWithUnits(user.isMetric, state);
      comment.innerHTML = getDimensionsString(model);
    });
  }

  function showLoading() {
    const vehicleList = document.getElementById('sygic-vehicle-list');
    const existingLoader = document.getElementById('sygic-loading-indicator');
    if (!existingLoader) {
      const sentinel = document.getElementById('sygic-scroll-sentinel');
      if (sentinel) {
        sentinel.insertAdjacentHTML('beforebegin', loadingTemplate);
      }
    }
  }

  function hideLoading() {
    const loader = document.getElementById('sygic-loading-indicator');
    if (loader) {
      loader.remove();
    }
  }

  function loadMoreItems() {
    if (isLoading || allDataLoaded || !cachedData) return;

    isLoading = true;
    showLoading();

    // Simular un pequeño delay para UX más suave
    setTimeout(() => {
      const { devices, dimensions, user } = cachedData;
      const storage = new DimensionsStorage(geotabApi);
      const vehicleList = document.getElementById('sygic-vehicle-list');
      const sentinel = document.getElementById('sygic-scroll-sentinel');

      const startIndex = currentPage * ITEMS_PER_PAGE;
      const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, devices.length);
      const itemsToRender = devices.slice(startIndex, endIndex);

      if (itemsToRender.length === 0) {
        allDataLoaded = true;
        hideLoading();
        if (sentinel) sentinel.remove();
        isLoading = false;
        return;
      }

      // Crear un fragment para mejor rendimiento
      const fragment = document.createDocumentFragment();
      const tempContainer = document.createElement('div');

      itemsToRender.forEach(device => {
        const html = createVehicleElement(device, dimensions, user);
        tempContainer.innerHTML = html;
        const li = tempContainer.firstElementChild;
        fragment.appendChild(li);
      });

      // Insertar antes del sentinel
      if (sentinel) {
        vehicleList.insertBefore(fragment, sentinel);
      } else {
        vehicleList.appendChild(fragment);
      }

      // Attach event listeners a los nuevos elementos
      const allRows = vehicleList.querySelectorAll('.sygic-vehicle');
      const newRows = Array.from(allRows).slice(startIndex, endIndex);
      newRows.forEach(row => attachEventListeners(row, storage, user));

      currentPage++;
      hideLoading();
      isLoading = false;

      // Verificar si hemos cargado todo
      if (endIndex >= devices.length) {
        allDataLoaded = true;
        if (sentinel) sentinel.remove();
      }
    }, 100);
  }

  function setupIntersectionObserver() {
    // Limpiar observer anterior si existe
    if (observer) {
      observer.disconnect();
    }

    const sentinel = document.getElementById('sygic-scroll-sentinel');
    if (!sentinel) return;

    const options = {
      root: null, // viewport
      rootMargin: '100px', // cargar un poco antes de llegar al final
      threshold: 0
    };

    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !isLoading && !allDataLoaded) {
          loadMoreItems();
        }
      });
    }, options);

    observer.observe(sentinel);
  }

  function renderDeviceList({ devices, dimensions, user }) {
    // Reset estado
    currentPage = 0;
    isLoading = false;
    allDataLoaded = false;
    cachedData = { devices, dimensions, user };

    let vehicleList = document.getElementById('sygic-vehicle-list');
    vehicleList.innerHTML = '';

    // Mostrar contador total
    const header = document.querySelector('.geotabPageHeader');
    let counter = document.getElementById('sygic-vehicle-counter');
    if (!counter) {
      counter = document.createElement('span');
      counter.id = 'sygic-vehicle-counter';
      counter.style.cssText = 'font-size: 14px; color: #666; margin-left: 10px;';
      header.querySelector('h1').appendChild(counter);
    }
    counter.textContent = ` (${devices.length} vehicles)`;

    // Agregar el sentinel para infinite scroll
    vehicleList.innerHTML = sentinelTemplate;

    // Cargar primera página
    loadMoreItems();

    // Configurar el observer
    setupIntersectionObserver();
  }

  async function prepareData() {
    let storage = new DimensionsStorage(geotabApi);

    let devices = await geotabApi.callAsync('Get', {
      typeName: 'Device',
      search: {
        groups: state.getGroupFilter(),
      },
    });

    let groups = await geotabApi.callAsync('Get', {
      typeName: 'Group',
    });

    let groupMap = Object.assign(
      {},
      ...groups.map((group) => {
        return {
          [group.id]: group.name ? group.name : group.id,
        };
      })
    );

    devices.map((device) => {
      device.groups.map((group) => {
        group.name = groupMap[group.id];
      });
    });

    let dimensions = await storage.getAllDimensionsModelsAsync();

    let session = await geotabApi.getSessionAsync();
    let geotabUser = await geotabApi.callAsync('Get', {
      typeName: 'User',
      search: {
        name: session.userName,
      },
    });

    const geotabClearances = await geotabApi.callAsync('Get', {
      typeName: 'Group',
      search: {
        id: 'groupSecurityId',
      },
    });

    let user = new User(geotabUser[0], geotabClearances);
    return { devices, dimensions, user };
  }

  // Agregar estilos para el spinner
  function addStyles() {
    if (document.getElementById('sygic-lazy-load-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'sygic-lazy-load-styles';
    styles.textContent = `
      .sygic-loading {
        list-style: none;
      }
      .sygic-spinner {
        width: 30px;
        height: 30px;
        border: 3px solid #f3f3f3;
        border-top: 3px solid #3498db;
        border-radius: 50%;
        animation: sygic-spin 1s linear infinite;
        margin: 0 auto 10px;
      }
      @keyframes sygic-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(styles);
  }

  return {
    initialize: async function (freshApi, freshState, initializeCallback) {
      if (freshState.translate) {
        freshState.translate(elAddin || '');
      }
      addStyles();
      initializeCallback();
    },

    focus: async function (freshApi, freshState) {
      elAddin.className = '';
      let data = await prepareData();
      renderDeviceList(data);
    },

    blur: function () {
      elAddin.className += ' hidden';
      // Limpiar observer al salir
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      // Reset estado
      currentPage = 0;
      isLoading = false;
      allDataLoaded = false;
      cachedData = null;
    },
  };
};