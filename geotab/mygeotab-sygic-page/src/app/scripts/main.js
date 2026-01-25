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
  
  var allDevices = [];
  var filteredDevices = [];
  var allDimensions = null;
  var currentUser = null;
  var storage = null;
  var groupMap = {};
  var vehicleModelsCache = {};
  var currentSearchQuery = '';
  var currentModelFilter = '';

  var geotabApi = ApiWrapper(api);

  var templateString = '<li>' +
    '<div class="g-col checkmateListBuilderRow sygic-vehicle" data-device-id="<%= vehicle.id %>">' +
      '<div class="g-row">' +
        '<div class="g-main g-main-col g-main_wider">' +
          '<div class="g-name"><span class="ellipsis"><%= vehicle.name %></span></div>' +
          '<div class="g-comment"><div class="secondaryData ellipsis"><%= vehicle_groups_string %></div></div>' +
          '<div class="g-comment"><div class="secondaryData ellipsis"><%= vehicle_model_string %></div></div>' +
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

  function getVehicleModel(device) {
    if (!device.vehicleIdentificationNumber) {
      return 'Sin VIN';
    }
    
    var cached = vehicleModelsCache[device.vehicleIdentificationNumber];
    if (cached) {
      return cached.make + ' ' + cached.model;
    }
    
    return 'Cargando...';
  }

  function getUniqueModels() {
    var models = {};
    
    for (var vin in vehicleModelsCache) {
      if (vehicleModelsCache.hasOwnProperty(vin)) {
        var info = vehicleModelsCache[vin];
        if (info.make && info.model) {
          var modelKey = info.make + ' ' + info.model;
          models[modelKey] = true;
        }
      }
    }
    
    var uniqueModels = Object.keys(models).sort();
    return uniqueModels;
  }

  async function decodeVins(devices) {
    var vins = devices
      .filter(function(device) {
        return device.vehicleIdentificationNumber && 
               !vehicleModelsCache[device.vehicleIdentificationNumber];
      })
      .map(function(device) {
        return device.vehicleIdentificationNumber;
      });

    if (vins.length === 0) {
      return;
    }

    // Procesar en lotes de 50 VINs para no sobrecargar la API
    var batchSize = 50;
    for (var i = 0; i < vins.length; i += batchSize) {
      var batch = vins.slice(i, i + batchSize);
      
      try {
        var result = await new Promise(function(resolve, reject) {
          api.call('DecodeVinsNew', {
            vins: batch
          }, resolve, reject);
        });

        result.forEach(function(vinInfo) {
          if (vinInfo.error === 'None' || !vinInfo.error) {
            vehicleModelsCache[vinInfo.vin] = {
              make: vinInfo.make || 'Desconocido',
              model: vinInfo.model || 'Desconocido',
              vehicleType: vinInfo.vehicleType,
              manufacturer: vinInfo.manufacturer
            };
          } else {
            vehicleModelsCache[vinInfo.vin] = {
              make: 'Error',
              model: 'decodificación',
              vehicleType: null,
              manufacturer: null
            };
          }
        });
      } catch (error) {
        console.error('[SYGIC] Error decoding VINs batch:', error);
        // Marcar VINs fallidos para no intentar nuevamente
        batch.forEach(function(vin) {
          if (!vehicleModelsCache[vin]) {
            vehicleModelsCache[vin] = {
              make: 'Error',
              model: 'API',
              vehicleType: null,
              manufacturer: null
            };
          }
        });
      }
    }
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

    var modelString = 'Modelo: ' + getVehicleModel(device);

    return compiledTemplate({
      vehicle: device,
      vehicle_dimensions_string: dimensionDetailsString,
      vehicle_groups_string: groupNames,
      vehicle_model_string: modelString,
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

  function showLoading(show, message) {
    var list = document.getElementById('sygic-vehicle-list');
    if (show) {
      message = message || 'Loading...';
      list.innerHTML = '<li style="text-align:center;padding:40px;list-style:none;">' +
        '<div class="sygic-spinner"></div><span>' + message + '</span></li>';
    }
  }

  function showNotificationBanner(message, type) {
    var banner = document.getElementById('sygic-notification-banner');
    if (!banner) return;
    
    banner.textContent = message;
    banner.className = 'sygic-notification-banner sygic-notification-' + type;
    
    // Ocultar después de 5 segundos
    setTimeout(function() {
      banner.classList.add('sygic-notification-fade-out');
      setTimeout(function() {
        banner.className = 'sygic-notification-banner hidden';
      }, 300);
    }, 5000);
  }

  function createSearchBar() {
    var existing = document.getElementById('sygic-search-bar');
    if (existing) {
      existing.remove();
    }

    var searchBar = document.createElement('div');
    searchBar.id = 'sygic-search-bar';
    searchBar.className = 'sygic-search-bar';
    
    var uniqueModels = getUniqueModels();
    var modelOptions = '<option value="">Todos los modelos</option>';
    uniqueModels.forEach(function(model) {
      modelOptions += '<option value="' + model + '">' + model + '</option>';
    });

    searchBar.innerHTML = 
      '<div class="sygic-search-container">' +
        '<svg class="sygic-search-icon" viewBox="0 0 24 24" width="20" height="20">' +
          '<path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>' +
        '</svg>' +
        '<input type="text" id="sygic-search-input" class="sygic-search-input" placeholder="Buscar por nombre de vehículo...">' +
        '<button id="sygic-search-clear" class="sygic-search-clear hidden">✕</button>' +
        '<select id="sygic-model-filter" class="sygic-model-filter">' +
          modelOptions +
        '</select>' +
        '<span class="sygic-search-results"></span>' +
        '<button id="sygic-update-routes" class="sygic-update-routes-btn">' +
          '<svg class="sygic-refresh-icon" viewBox="0 0 24 24" width="18" height="18">' +
            '<path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>' +
          '</svg>' +
          '<span class="sygic-btn-text">Actualizar rutas</span>' +
          '<div class="sygic-btn-spinner hidden"></div>' +
        '</button>' +
      '</div>' +
      '<div id="sygic-notification-banner" class="sygic-notification-banner hidden"></div>';

    var listContainer = document.querySelector('.checkmateListBuilder');
    if (listContainer) {
      listContainer.parentNode.insertBefore(searchBar, listContainer);
    }

    var searchInput = searchBar.querySelector('#sygic-search-input');
    var clearBtn = searchBar.querySelector('#sygic-search-clear');
    var resultsSpan = searchBar.querySelector('.sygic-search-results');
    var updateRoutesBtn = searchBar.querySelector('#sygic-update-routes');
    var modelFilter = searchBar.querySelector('#sygic-model-filter');

    var searchTimeout;
    searchInput.oninput = function() {
      clearTimeout(searchTimeout);
      var query = this.value.trim();
      currentSearchQuery = query;
      
      if (query.length > 0) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }

      searchTimeout = setTimeout(function() {
        applyFilters();
      }, 300);
    };

    clearBtn.onclick = function() {
      searchInput.value = '';
      currentSearchQuery = '';
      clearBtn.classList.add('hidden');
      applyFilters();
      searchInput.focus();
    };

    modelFilter.onchange = function() {
      currentModelFilter = this.value;
      applyFilters();
    };

    updateRoutesBtn.onclick = async function() {
      var btnText = updateRoutesBtn.querySelector('.sygic-btn-text');
      var btnIcon = updateRoutesBtn.querySelector('.sygic-refresh-icon');
      var btnSpinner = updateRoutesBtn.querySelector('.sygic-btn-spinner');
      
      // Deshabilitar botón y mostrar spinner
      updateRoutesBtn.disabled = true;
      btnText.classList.add('hidden');
      btnIcon.classList.add('hidden');
      btnSpinner.classList.remove('hidden');

      try {
        var response = await fetch('http://localhost/sygic/cron/');
        
        if (response.ok) {
          showNotificationBanner('Rutas actualizadas correctamente', 'success');
        } else {
          showNotificationBanner('Error al actualizar las rutas', 'error');
        }
      } catch (error) {
        console.error('[SYGIC] Error updating routes:', error);
        showNotificationBanner('Error de conexión al actualizar las rutas', 'error');
      } finally {
        // Restaurar botón
        updateRoutesBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnIcon.classList.remove('hidden');
        btnSpinner.classList.add('hidden');
      }
    };

    function applyFilters() {
      filteredDevices = allDevices.filter(function(device) {
        var matchesSearch = true;
        var matchesModel = true;

        // Filtro de búsqueda por nombre
        if (currentSearchQuery) {
          var lowerQuery = currentSearchQuery.toLowerCase();
          matchesSearch = device.name.toLowerCase().indexOf(lowerQuery) !== -1;
        }

        // Filtro por modelo
        if (currentModelFilter) {
          matchesModel = getVehicleModel(device) === currentModelFilter;
        }

        return matchesSearch && matchesModel;
      });

      var totalText = allDevices.length + ' vehículos';
      if (filteredDevices.length !== allDevices.length) {
        resultsSpan.textContent = filteredDevices.length + ' de ' + totalText;
      } else {
        resultsSpan.textContent = totalText;
      }
      
      renderDevices();
    }

    // Inicializar con todos los dispositivos
    filteredDevices = allDevices;
    resultsSpan.textContent = allDevices.length + ' vehículos';
  }

  function renderDevices() {
    var list = document.getElementById('sygic-vehicle-list');
    list.innerHTML = '';

    if (filteredDevices.length === 0) {
      list.innerHTML = '<li style="text-align:center;padding:40px;list-style:none;color:#5f6368;">' +
        'No se encontraron vehículos</li>';
      return;
    }

    var fragment = document.createDocumentFragment();
    var tempDiv = document.createElement('div');

    filteredDevices.forEach(function(device) {
      tempDiv.innerHTML = createDeviceHTML(device);
      var li = tempDiv.firstElementChild;
      var row = li.querySelector('.sygic-vehicle');
      if (row) {
        attachEventsToRow(row);
      }
      fragment.appendChild(li);
    });

    list.appendChild(fragment);
    
    var container = document.querySelector('.checkmateListBuilder');
    if (container) {
      container.scrollTop = 0;
    }
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
      
      '.sygic-search-bar{padding:16px;background:#fff;border-bottom:1px solid #e0e0e0}' +
      '.sygic-search-container{display:flex;align-items:center;gap:12px;max-width:1100px;' +
      'margin:0 auto;position:relative}' +
      '.sygic-search-icon{color:#5f6368;flex-shrink:0}' +
      '.sygic-search-input{flex:1;height:40px;padding:0 40px 0 12px;border:1px solid #dadce0;' +
      'border-radius:20px;font-size:14px;outline:none;transition:all .2s}' +
      '.sygic-search-input:focus{border-color:#1a73e8;box-shadow:0 1px 6px rgba(26,115,232,0.3)}' +
      '.sygic-search-clear{position:absolute;right:480px;background:transparent;border:none;' +
      'color:#5f6368;font-size:18px;cursor:pointer;width:24px;height:24px;' +
      'display:flex;align-items:center;justify-content:center;border-radius:50%;' +
      'transition:all .2s}' +
      '.sygic-search-clear:hover{background:#f1f3f4;color:#202124}' +
      '.sygic-search-clear.hidden{display:none}' +
      
      '.sygic-model-filter{height:40px;padding:0 12px;border:1px solid #dadce0;' +
      'border-radius:20px;font-size:14px;outline:none;background:#fff;cursor:pointer;' +
      'transition:all .2s;min-width:180px}' +
      '.sygic-model-filter:focus{border-color:#1a73e8;box-shadow:0 1px 6px rgba(26,115,232,0.3)}' +
      '.sygic-model-filter:hover{border-color:#b0b0b0}' +
      
      '.sygic-search-results{color:#5f6368;font-size:13px;white-space:nowrap;min-width:100px;' +
      'text-align:right}' +
      
      '.sygic-update-routes-btn{display:flex;align-items:center;gap:8px;height:40px;' +
      'padding:0 16px;background:#1a73e8;color:#fff;border:none;border-radius:20px;' +
      'font-size:14px;font-weight:500;cursor:pointer;transition:all .2s;white-space:nowrap}' +
      '.sygic-update-routes-btn:hover:not(:disabled){background:#1557b0;box-shadow:0 1px 3px rgba(0,0,0,0.2)}' +
      '.sygic-update-routes-btn:disabled{opacity:0.6;cursor:not-allowed}' +
      '.sygic-refresh-icon{flex-shrink:0}' +
      '.sygic-btn-spinner{width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);' +
      'border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite}' +
      '.sygic-btn-text{line-height:1}' +
      
      '.sygic-notification-banner{padding:12px 20px;margin:0 16px 0 16px;border-radius:4px;' +
      'font-size:14px;font-weight:500;text-align:center;transition:opacity .3s}' +
      '.sygic-notification-banner.hidden{display:none}' +
      '.sygic-notification-success{background:#e6f4ea;color:#137333;border:1px solid #b7e1cd}' +
      '.sygic-notification-error{background:#fce8e6;color:#c5221f;border:1px solid #f4c7c3}' +
      '.sygic-notification-fade-out{opacity:0}';

    document.head.appendChild(style);
  }

  // ==========================================
  // FUNCIONES DE CARGA
  // ==========================================

  async function loadGroups() {
    var groups = await new Promise(function(resolve, reject) {
      api.call('Get', { typeName: 'Group' }, resolve, reject);
    });
    
    groupMap = {};
    groups.forEach(function(g) {
      groupMap[g.id] = g.name || g.id;
    });
    
    return groups;
  }

  async function loadDimensions() {
    var dimensions = await storage.getAllDimensionsModelsAsync();
    allDimensions = dimensions;
    return dimensions;
  }

  async function loadSession() {
    var session = await geotabApi.getSessionAsync();
    return session;
  }

  async function loadUser(userName) {
    var users = await new Promise(function(resolve, reject) {
      api.call('Get', { 
        typeName: 'User', 
        search: { name: userName } 
      }, resolve, reject);
    });
    
    var clearances = await new Promise(function(resolve, reject) {
      api.call('Get', { 
        typeName: 'Group', 
        search: { id: 'groupSecurityId' } 
      }, resolve, reject);
    });
    
    currentUser = new User(users[0], clearances);
    return currentUser;
  }

  async function loadDevices() {
    var propertySelector = {
      fields: ['id', 'name', 'groups', 'vehicleIdentificationNumber'],
      isIncluded: true
    };
    
    var search = {
      groups: state.getGroupFilter()
    };
    
    var devices = await new Promise(function(resolve, reject) {
      api.call('Get', {
        typeName: 'Device',
        propertySelector: propertySelector,
        search: search
      }, resolve, reject);
    });
    
    devices.forEach(function(device) {
      device.groups.forEach(function(g) {
        g.name = groupMap[g.id] || g.id;
      });
    });
    
    allDevices = devices;
    filteredDevices = devices;
    return devices;
  }

  return {
    initialize: async function(freshApi, freshState, initializeCallback) {
      if (freshState.translate) {
        freshState.translate(elAddin || '');
      }
      addStyles();
      storage = new DimensionsStorage(geotabApi);
      initializeCallback();
    },

    focus: async function() {
      elAddin.className = '';
      showLoading(true, 'Cargando vehículos...');

      try {
        await loadGroups();
        await loadDimensions();
        var session = await loadSession();
        await loadUser(session.userName);
        await loadDevices();
        
        showLoading(true, 'Decodificando VINs...');
        await decodeVins(allDevices);
        
        createSearchBar();
        renderDevices();
        
      } catch (error) {
        console.error('[SYGIC] ERROR:', error);
        var list = document.getElementById('sygic-vehicle-list');
        list.innerHTML = '<li style="color:red;padding:20px;">Error: ' + error + '</li>';
      }
    },

    blur: function() {
      elAddin.className += ' hidden';
      
      var searchBar = document.getElementById('sygic-search-bar');
      if (searchBar) {
        searchBar.remove();
      }
      
      allDevices = [];
      filteredDevices = [];
      currentSearchQuery = '';
      currentModelFilter = '';
    }
  };
};