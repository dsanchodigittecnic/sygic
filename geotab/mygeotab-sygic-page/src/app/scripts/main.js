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

  var elAddin = document.getElementById('mygeotabSygicPage');
  
  // Configuración de paginación
  var PAGE_SIZE = 25;
  var currentPage = 1;
  var totalPages = 1;
  
  // Caché de datos
  var allDevices = [];
  var allDimensions = null;
  var currentUser = null;
  var storage = null;
  var groupMap = {};

  // Guardamos referencia a la API original de Geotab
  var geotabApi = ApiWrapper(api);
  var originalApi = api;

  var templateString = '<li>' +
    '<div class="g-col checkmateListBuilderRow sygic-vehicle" data-device-id="<%= vehicle.id %>">' +
      '<div class="g-row">' +
        '<div class="g-main g-main-col g-main_wider">' +
          '<div class="g-name"><span class="ellipsis"><%= vehicle.name %></span></div>' +
          '<div class="g-comment"><div class="secondaryData ellipsis"><%= vehicle_groups_string %></div></div>' +
          '<div class="g-comment vehicle-dimensions-comment"><div class="secondaryData ellipsis"><%= vehicle_dimensions_string %></div></div>' +
        '</div>' +
        '<div class="g-ctrl">' +
          '<a href="#" class="geotabButton geotabButton-empty sygic-edit-dimensions<%= user.canModify ? "" : " hidden" %>">' +
            '<svg class="svgIcon geotabButtonIcons"><use xlink:href="#geo-pencil-icon">' +
              '<svg viewBox="0 0 32 32" id="geo-pencil-icon"><path d="M7.79 29.124l1.878-1.915-4.919-4.919-1.915 1.915v2.253h2.703v2.666H7.79zm10.927-19.45q0-.45-.45-.45-.189 0-.339.15L6.551 20.714q-.15.15-.15.375 0 .45.488.45.188 0 .338-.15l11.377-11.34q.113-.15.113-.375zM17.59 5.657l8.711 8.71L8.88 31.828H.17V23.08zm14.306 2.027q0 1.09-.751 1.878l-3.492 3.492-8.711-8.749L22.434.851q.75-.789 1.877-.789 1.09 0 1.915.789l4.919 4.918q.75.827.75 1.915z"></path></svg>' +
            '</use></svg>' +
          '</a>' +
        '</div>' +
      '</div>' +
      '<div class="g-row hidden sygic-vehicle-dimensions-form">' +
        '<fieldset class="geotabFieldset sygic-vehicle-dimensions-fieldset" style="background-color: transparent">' +
          '<% _.each(vehicle_dimensions, function(dimension) { %>' +
            '<% if (dimension.key != "hazmat") { %>' +
              '<% var name = "sygic-truck-dimensions-" + dimension.key; %>' +
              '<% if (dimension.options) { %>' +
                '<div class="geotabField">' +
                  '<label for="<%= name %>"><%= dimension.label %></label>' +
                  '<select name="<%= name %>" class="geotabFormEditField">' +
                    '<% _.each(dimension.options, function(option, key) { %>' +
                      '<option value="<%= key %>" <%= dimension.value === key ? "selected" : "" %>><%= option %></option>' +
                    '<% }); %>' +
                  '</select>' +
                '</div>' +
              '<% } else { %>' +
                '<div class="geotabField">' +
                  '<label for="<%= name %>"><%= dimension.label %></label>' +
                  '<input type="number" step="0.1" name="<%= name %>" class="geotabFormEditField" value="<%= dimension.value %>" />' +
                '</div>' +
              '<% } %>' +
            '<% } %>' +
          '<% }); %>' +
          '<div data-name="hazmat-fields">' +
            '<% _.each(vehicle_hazmat, function(hazmat) { %>' +
              '<% var name = "sygic-truck-hazmat-" + hazmat.key; %>' +
              '<% if (hazmat.key === "adr_tunnel") { %>' +
                '<div class="geotabField" <%= !hazmat.visible ? "hidden" : "" %>>' +
                  '<label for="<%= name %>"><%= hazmat.label %></label>' +
                  '<select name="<%= name %>" class="geotabFormEditField">' +
                    '<option></option>' +
                    '<% _.each(hazmat.options, function(option) { %>' +
                      '<option value="<%= option %>" <%= hazmat.value === option ? "selected" : "" %>><%= option %></option>' +
                    '<% }); %>' +
                  '</select>' +
                '</div>' +
              '<% } else { %>' +
                '<div class="geotabField" <%= !hazmat.visible ? "hidden" : "" %>>' +
                  '<label for="<%= name %>"><%= hazmat.label %></label>' +
                  '<input type="checkbox" name="<%= name %>" class="geotabFormEditField" <%= hazmat.value ? "checked" : "" %> />' +
                '</div>' +
              '<% } %>' +
            '<% }); %>' +
          '</div>' +
          '<button class="geotabButton sygic-vehicle-dimensions-save"><%= apply_changes %></button>' +
        '</fieldset>' +
      '</div>' +
    '</div>' +
  '</li>';

  var compiledTemplate = _.template(templateString);

  // Helper para llamar a la API directa de Geotab con Promesas
  function apiCall(method, params) {
    return new Promise(function(resolve, reject) {
      originalApi.call(method, params, function(result) {
        resolve(result);
      }, function(error) {
        reject(error);
      });
    });
  }

  function getDimensionsString(viewModel) {
    var parts = [];
    for (var key in viewModel) {
      if (viewModel.hasOwnProperty(key)) {
        var model = viewModel[key];
        if (typeof model.value === 'number' || typeof model.value === 'string') {
          if (key === 'routing_type') {
            parts.push(model.label + ': ' + DimensionsModel.getRoutingTypeString(model.value, state));
          } else {
            parts.push(model.label + ': ' + model.value);
          }
        }
      }
    }
    return parts.join(', ');
  }

  function getViewModelForDevice(deviceId) {
    if (allDimensions && allDimensions[deviceId]) {
      return allDimensions[deviceId].getViewModelWithUnits(currentUser.isMetric, state);
    }
    return DimensionsModel.getEmptyViewModel(currentUser.isMetric, state);
  }

  function createDeviceHTML(device) {
    var viewModel = getViewModelForDevice(device.id);
    var dimensionDetailsString = allDimensions && allDimensions[device.id]
      ? getDimensionsString(viewModel)
      : 'Dimensions unset';

    var dimensionsTemplateObject = Object.keys(viewModel)
      .filter(function(key) { return key !== 'hazmat'; })
      .map(function(key) {
        return {
          value: viewModel[key].value,
          key: key,
          label: viewModel[key].label,
          options: viewModel[key].options
        };
      });

    var hazmatTemplateObject = Object.keys(viewModel.hazmat.value).map(function(key) {
      return {
        value: viewModel.hazmat.value[key].value,
        key: key,
        label: viewModel.hazmat.value[key].label,
        visible: viewModel.hazmat.value[key].visible,
        options: viewModel.hazmat.value[key].options
      };
    });

    var groupNames = device.groups
      .map(function(g) { return g.name || groupMap[g.id] || g.id; })
      .join(', ');

    return compiledTemplate({
      vehicle: device,
      vehicle_dimensions_string: dimensionDetailsString,
      vehicle_groups_string: groupNames,
      vehicle_dimensions: dimensionsTemplateObject,
      vehicle_hazmat: hazmatTemplateObject,
      user: currentUser,
      apply_changes: state.translate('Apply Changes')
    });
  }

  function attachEventsToRow(row) {
    var deviceId = row.dataset.deviceId;
    var editBtn = row.querySelector('.sygic-edit-dimensions');
    var form = row.querySelector('.sygic-vehicle-dimensions-form');
    var comment = row.querySelector('.vehicle-dimensions-comment');

    if (editBtn) {
      editBtn.onclick = function(e) {
        e.preventDefault();
        form.classList.toggle('hidden');
        comment.classList.toggle('hidden');
      };
    }

    var saveBtn = row.querySelector('.sygic-vehicle-dimensions-save');
    if (saveBtn) {
      saveBtn.onclick = async function() {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
          var fieldSet = row.querySelector('.sygic-vehicle-dimensions-fieldset');
          var inputs = Dimensions.getInputValues(fieldSet);
          var model = DimensionsModel.getFromStringInputs(inputs, currentUser.isMetric);

          var stored = await storage.getDimensionsModelAsync(deviceId);
          if (!stored) {
            await storage.addDimensionsAsync(model, deviceId);
          } else {
            await storage.setDimensionsAsync(model, stored.id, deviceId);
          }

          if (!allDimensions) {
            allDimensions = {};
          }
          allDimensions[deviceId] = model;

          var vm = model.getViewModelWithUnits(currentUser.isMetric, state);
          comment.querySelector('.secondaryData').textContent = getDimensionsString(vm);

          form.classList.add('hidden');
          comment.classList.remove('hidden');
        } catch (e) {
          console.error('[SYGIC] Error saving:', e);
        }

        saveBtn.disabled = false;
        saveBtn.textContent = state.translate('Apply Changes');
      };
    }
  }

  function showLoading(show) {
    var list = document.getElementById('sygic-vehicle-list');
    if (show) {
      list.innerHTML = '<li style="text-align:center;padding:40px;list-style:none;">' +
        '<div class="sygic-spinner"></div><span>Loading...</span></li>';
    }
  }

  function renderCurrentPage() {
    var list = document.getElementById('sygic-vehicle-list');
    list.innerHTML = '';

    var startIndex = (currentPage - 1) * PAGE_SIZE;
    var endIndex = Math.min(startIndex + PAGE_SIZE, allDevices.length);
    var devicesToRender = allDevices.slice(startIndex, endIndex);

    console.log('[SYGIC] Rendering page', currentPage, '- devices', startIndex + 1, 'to', endIndex, 'of', allDevices.length);

    var fragment = document.createDocumentFragment();
    var tempDiv = document.createElement('div');

    devicesToRender.forEach(function(device) {
      tempDiv.innerHTML = createDeviceHTML(device);
      var li = tempDiv.firstElementChild;
      var row = li.querySelector('.sygic-vehicle');
      if (row) {
        attachEventsToRow(row);
      }
      fragment.appendChild(li);
    });

    list.appendChild(fragment);
    updatePaginator();
    
    var container = document.querySelector('.checkmateListBuilder');
    if (container) {
      container.scrollTop = 0;
    }
  }

  function updatePaginator() {
    var paginator = document.getElementById('sygic-paginator');
    if (!paginator) return;

    var info = paginator.querySelector('.sygic-page-info');
    var prevBtn = paginator.querySelector('.sygic-prev');
    var nextBtn = paginator.querySelector('.sygic-next');
    var firstBtn = paginator.querySelector('.sygic-first');
    var lastBtn = paginator.querySelector('.sygic-last');
    var pageInput = paginator.querySelector('.sygic-page-input');
    var totalPagesSpan = paginator.querySelector('.sygic-total-pages');

    var startItem = ((currentPage - 1) * PAGE_SIZE) + 1;
    var endItem = Math.min(currentPage * PAGE_SIZE, allDevices.length);

    info.textContent = startItem + ' - ' + endItem + ' of ' + allDevices.length;
    pageInput.value = currentPage;
    pageInput.max = totalPages;
    totalPagesSpan.textContent = totalPages;

    prevBtn.disabled = currentPage <= 1;
    firstBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    lastBtn.disabled = currentPage >= totalPages;
  }

  function goToPage(page) {
    page = parseInt(page, 10);
    if (isNaN(page) || page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    
    if (page !== currentPage) {
      currentPage = page;
      renderCurrentPage();
    }
  }

  function createPaginator() {
    var existingPaginator = document.getElementById('sygic-paginator');
    if (existingPaginator) {
      existingPaginator.remove();
    }

    var paginator = document.createElement('div');
    paginator.id = 'sygic-paginator';
    paginator.className = 'sygic-paginator';
    paginator.innerHTML = 
      '<div class="sygic-paginator-left">' +
        '<span class="sygic-page-info">1 - 25 of 100</span>' +
      '</div>' +
      '<div class="sygic-paginator-center">' +
        '<button class="sygic-page-btn sygic-first" title="First page">' +
          '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18.41 16.59L13.82 12l4.59-4.59L17 6l-6 6 6 6zM6 6h2v12H6z"/></svg>' +
        '</button>' +
        '<button class="sygic-page-btn sygic-prev" title="Previous page">' +
          '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>' +
        '</button>' +
        '<div class="sygic-page-input-container">' +
          '<input type="number" class="sygic-page-input" min="1" value="1"> ' +
          '<span class="sygic-page-total">/ <span class="sygic-total-pages">1</span></span>' +
        '</div>' +
        '<button class="sygic-page-btn sygic-next" title="Next page">' +
          '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>' +
        '</button>' +
        '<button class="sygic-page-btn sygic-last" title="Last page">' +
          '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M5.59 7.41L10.18 12l-4.59 4.59L7 18l6-6-6-6zM16 6h2v12h-2z"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="sygic-paginator-right">' +
        '<label>Per page: </label>' +
        '<select class="sygic-page-size">' +
          '<option value="10">10</option>' +
          '<option value="25" selected>25</option>' +
          '<option value="50">50</option>' +
          '<option value="100">100</option>' +
        '</select>' +
      '</div>';

    var listContainer = document.querySelector('.checkmateListBuilder');
    if (listContainer) {
      listContainer.parentNode.insertBefore(paginator, listContainer.nextSibling);
    }

    var prevBtn = paginator.querySelector('.sygic-prev');
    var nextBtn = paginator.querySelector('.sygic-next');
    var firstBtn = paginator.querySelector('.sygic-first');
    var lastBtn = paginator.querySelector('.sygic-last');
    var pageInput = paginator.querySelector('.sygic-page-input');
    var pageSizeSelect = paginator.querySelector('.sygic-page-size');

    prevBtn.onclick = function() { goToPage(currentPage - 1); };
    nextBtn.onclick = function() { goToPage(currentPage + 1); };
    firstBtn.onclick = function() { goToPage(1); };
    lastBtn.onclick = function() { goToPage(totalPages); };

    pageInput.onchange = function() { goToPage(this.value); };
    pageInput.onkeydown = function(e) {
      if (e.key === 'Enter') {
        goToPage(this.value);
      }
    };

    pageSizeSelect.value = PAGE_SIZE;
    pageSizeSelect.onchange = function() {
      PAGE_SIZE = parseInt(this.value, 10);
      totalPages = Math.ceil(allDevices.length / PAGE_SIZE);
      currentPage = 1;
      renderCurrentPage();
    };
  }

  // CARGA OPTIMIZADA USANDO API DIRECTA CON propertySelector
  async function loadAllDevices() {
    console.log('[SYGIC] Loading devices with propertySelector...');
    console.time('[SYGIC] Device load time');
    
    var devices = await apiCall('Get', {
      typeName: 'Device',
      propertySelector: {
        fields: ['id', 'name', 'groups'],
        isIncluded: true
      },
      search: {
        groups: state.getGroupFilter()
      }
    });

    console.timeEnd('[SYGIC] Device load time');
    console.log('[SYGIC] Loaded', devices.length, 'devices');

    devices.forEach(function(device) {
      device.groups.forEach(function(g) {
        g.name = groupMap[g.id] || g.id;
      });
    });

    allDevices = devices;
    totalPages = Math.ceil(allDevices.length / PAGE_SIZE);
    currentPage = 1;
  }

  async function loadStaticData() {
    console.log('[SYGIC] Loading static data...');
    console.time('[SYGIC] Static data load time');

    var results = await Promise.all([
      apiCall('Get', { typeName: 'Group' }),
      storage.getAllDimensionsModelsAsync(),
      geotabApi.getSessionAsync()
    ]);

    var groups = results[0];
    var dimensions = results[1];
    var session = results[2];

    console.log('[SYGIC] Groups:', groups.length);

    groupMap = {};
    groups.forEach(function(g) {
      groupMap[g.id] = g.name || g.id;
    });

    allDimensions = dimensions;

    var userResults = await Promise.all([
      apiCall('Get', { typeName: 'User', search: { name: session.userName } }),
      apiCall('Get', { typeName: 'Group', search: { id: 'groupSecurityId' } })
    ]);

    currentUser = new User(userResults[0][0], userResults[1]);
    console.timeEnd('[SYGIC] Static data load time');
  }

  function addStyles() {
    if (document.getElementById('sygic-styles')) {
      return;
    }
    var style = document.createElement('style');
    style.id = 'sygic-styles';
    style.textContent =
      '.sygic-spinner{width:24px;height:24px;border:3px solid #e0e0e0;' +
      'border-top-color:#1a73e8;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 8px}' +
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '#sygic-vehicle-list{padding:0;margin:0}' +
      '.sygic-paginator{display:flex;align-items:center;justify-content:space-between;' +
      'padding:12px 16px;background:#f8f9fa;border-top:1px solid #e0e0e0}' +
      '.sygic-paginator-left{flex:1}' +
      '.sygic-paginator-center{display:flex;align-items:center;gap:8px}' +
      '.sygic-paginator-right{flex:1;text-align:right}' +
      '.sygic-page-info{color:#5f6368;font-size:13px}' +
      '.sygic-page-btn{width:32px;height:32px;border:1px solid #dadce0;border-radius:4px;' +
      'background:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'color:#5f6368;transition:all .2s}' +
      '.sygic-page-btn:hover:not(:disabled){background:#f1f3f4;border-color:#1a73e8;color:#1a73e8}' +
      '.sygic-page-btn:disabled{opacity:.4;cursor:not-allowed}' +
      '.sygic-page-input-container{display:flex;align-items:center;gap:6px}' +
      '.sygic-page-input{width:50px;height:30px;border:1px solid #dadce0;border-radius:4px;' +
      'text-align:center;font-size:13px;padding:0 4px}' +
      '.sygic-page-input:focus{outline:none;border-color:#1a73e8}' +
      '.sygic-page-total{color:#5f6368;font-size:13px}' +
      '.sygic-page-size{height:30px;border:1px solid #dadce0;border-radius:4px;' +
      'padding:0 8px;font-size:13px;cursor:pointer}' +
      '.sygic-page-size:focus{outline:none;border-color:#1a73e8}' +
      '.sygic-paginator-right label{color:#5f6368;font-size:13px;margin-right:6px}';

    document.head.appendChild(style);
  }

  return {
    initialize: async function(freshApi, freshState, initializeCallback) {
      console.log('[SYGIC] ============ INITIALIZING ============');
      if (freshState.translate) {
        freshState.translate(elAddin || '');
      }
      addStyles();
      storage = new DimensionsStorage(geotabApi);
      initializeCallback();
    },

    focus: async function() {
      console.log('[SYGIC] ============ FOCUS ============');
      elAddin.className = '';
      showLoading(true);

      try {
        await loadStaticData();
        await loadAllDevices();
        createPaginator();
        renderCurrentPage();
      } catch (error) {
        console.error('[SYGIC] Init error:', error);
        var list = document.getElementById('sygic-vehicle-list');
        list.innerHTML = '<li style="color:red;padding:20px;">Error loading. Please refresh.</li>';
      }
    },

    blur: function() {
      console.log('[SYGIC] ============ BLUR ============');
      elAddin.className += ' hidden';
      
      var paginator = document.getElementById('sygic-paginator');
      if (paginator) {
        paginator.remove();
      }
      
      allDevices = [];
      currentPage = 1;
      totalPages = 1;
    }
  };
};