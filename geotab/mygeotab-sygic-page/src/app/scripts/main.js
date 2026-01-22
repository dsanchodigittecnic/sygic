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
  const PAGE_SIZE = 50;
  let currentFromIndex = 0;
  let isLoading = false;
  let hasMoreData = true;
  
  // Caché de datos
  let allDimensions = null;
  let currentUser = null;
  let storage = null;
  let groupMap = {};
  let totalDevicesLoaded = 0;

  let geotabApi = ApiWrapper(api);

  // Template compilado - todas las comillas como simples
  const templateString = '<li>' +
  '<div class=\'g-col checkmateListBuilderRow sygic-vehicle\' data-device-id=\'<%= vehicle.id %>\'>' +
    '<div class=\'g-row\'>' +
      '<div class=\'g-main g-main-col g-main_wider\'>' +
        '<div class=\'g-name\'><span class=\'ellipsis\'><%= vehicle.name %></span></div>' +
        '<div class=\'g-comment\'><div class=\'secondaryData ellipsis\'><%= vehicle_groups_string %></div></div>' +
        '<div class=\'g-comment vehicle-dimensions-comment\'><div class=\'secondaryData ellipsis\'><%= vehicle_dimensions_string %></div></div>' +
      '</div>' +
      '<div class=\'g-ctrl\'>' +
        '<a href=\'#\' class=\'geotabButton geotabButton-empty sygic-edit-dimensions <%= user.canModify ? "" : "hidden" %>\'>' +
          '<svg class=\'svgIcon geotabButtonIcons\'><use xlink:href=\'#geo-pencil-icon\'>' +
            '<svg viewBox=\'0 0 32 32\' id=\'geo-pencil-icon\'><path d=\'M7.79 29.124l1.878-1.915-4.919-4.919-1.915 1.915v2.253h2.703v2.666H7.79zm10.927-19.45q0-.45-.45-.45-.189 0-.339.15L6.551 20.714q-.15.15-.15.375 0 .45.488.45.188 0 .338-.15l11.377-11.34q.113-.15.113-.375zM17.59 5.657l8.711 8.71L8.88 31.828H.17V23.08zm14.306 2.027q0 1.09-.751 1.878l-3.492 3.492-8.711-8.749L22.434.851q.75-.789 1.877-.789 1.09 0 1.915.789l4.919 4.918q.75.827.75 1.915z\'></path></svg>' +
          '</use></svg>' +
        '</a>' +
      '</div>' +
    '</div>' +
    '<div class=\'g-row hidden sygic-vehicle-dimensions-form\'>' +
      '<fieldset class=\'geotabFieldset sygic-vehicle-dimensions-fieldset\' style=\'background-color: transparent\'>' +
        '<% _.each(vehicle_dimensions, function(dimension) { %>' +
          '<% if (dimension.key != "hazmat") { %>' +
            '<% var name = "sygic-truck-dimensions-" + dimension.key; %>' +
            '<% if (dimension.options) { %>' +
              '<div class=\'geotabField\'>' +
                '<label for=\'<%= name %>\'><%= dimension.label %></label>' +
                '<select name=\'<%= name %>\' class=\'geotabFormEditField\'>' +
                  '<% _.each(dimension.options, function(option, key) { %>' +
                    '<option value=\'<%= key %>\' <%= dimension.value === key ? "selected" : "" %>><%= option %></option>' +
                  '<% }); %>' +
                '</select>' +
              '</div>' +
            '<% } else { %>' +
              '<div class=\'geotabField\'>' +
                '<label for=\'<%= name %>\'><%= dimension.label %></label>' +
                '<input type=\'number\' step=\'0.1\' name=\'<%= name %>\' class=\'geotabFormEditField\' value=\'<%= dimension.value %>\' />' +
              '</div>' +
            '<% } %>' +
          '<% } %>' +
        '<% }); %>' +
        '<div data-name=\'hazmat-fields\'>' +
          '<% _.each(vehicle_hazmat, function(hazmat) { %>' +
            '<% var name = "sygic-truck-hazmat-" + hazmat.key; %>' +
            '<% if (hazmat.key === "adr_tunnel") { %>' +
              '<div class=\'geotabField\' <%= !hazmat.visible ? "hidden" : "" %>>' +
                '<label for=\'<%= name %>\'><%= hazmat.label %></label>' +
                '<select name=\'<%= name %>\' class=\'geotabFormEditField\'>' +
                  '<option></option>' +
                  '<% _.each(hazmat.options, function(option) { %>' +
                    '<option value=\'<%= option %>\' <%= hazmat.value === option ? "selected" : "" %>><%= option %></option>' +
                  '<% }); %>' +
                '</select>' +
              '</div>' +
            '<% } else { %>' +
              '<div class=\'geotabField\' <%= !hazmat.visible ? "hidden" : "" %>>' +
                '<label for=\'<%= name %>\'><%= hazmat.label %></label>' +
                '<input type=\'checkbox\' name=\'<%= name %>\' class=\'geotabFormEditField\' <%= hazmat.value ? "checked" : "" %> />' +
              '</div>' +
            '<% } %>' +
          '<% }); %>' +
        '</div>' +
        '<button class=\'geotabButton sygic-vehicle-dimensions-save\'><%= apply_changes %></button>' +
      '</fieldset>' +
    '</div>' +
  '</div>' +
'</li>';

  let compiledTemplate = _.template(templateString);

  function getDimensionsString(viewModel) {
    let parts = [];
    for (const key in viewModel) {
      if (viewModel.hasOwnProperty(key)) {
        const model = viewModel[key];
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
    const viewModel = getViewModelForDevice(device.id);
    const dimensionDetailsString = allDimensions && allDimensions[device.id] 
      ? getDimensionsString(viewModel) 
      : 'Dimensions unset';

    const dimensionsTemplateObject = Object.keys(viewModel)
      .filter(function(key) { return key !== 'hazmat'; })
      .map(function(key) {
        return {
          value: viewModel[key].value,
          key: key,
          label: viewModel[key].label,
          options: viewModel[key].options,
        };
      });

    const hazmatTemplateObject = Object.keys(viewModel.hazmat.value).map(function(key) {
      return {
        value: viewModel.hazmat.value[key].value,
        key: key,
        label: viewModel.hazmat.value[key].label,
        visible: viewModel.hazmat.value[key].visible,
        options: viewModel.hazmat.value[key].options,
      };
    });

    const groupNames = device.groups
      .map(function(g) { return g.name || groupMap[g.id] || g.id; })
      .join(', ');

    return compiledTemplate({
      vehicle: device,
      vehicle_dimensions_string: dimensionDetailsString,
      vehicle_groups_string: groupNames,
      vehicle_dimensions: dimensionsTemplateObject,
      vehicle_hazmat: hazmatTemplateObject,
      user: currentUser,
      apply_changes: state.translate('Apply Changes'),
    });
  }

  function attachEventsToRow(row) {
    const deviceId = row.dataset.deviceId;
    const editBtn = row.querySelector('.sygic-edit-dimensions');
    const form = row.querySelector('.sygic-vehicle-dimensions-form');
    const comment = row.querySelector('.vehicle-dimensions-comment');

    if (editBtn) {
      editBtn.onclick = function(e) {
        e.preventDefault();
        form.classList.toggle('hidden');
        comment.classList.toggle('hidden');
      };
    }

    const saveBtn = row.querySelector('.sygic-vehicle-dimensions-save');
    if (saveBtn) {
      saveBtn.onclick = async function() {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        
        try {
          const fieldSet = row.querySelector('.sygic-vehicle-dimensions-fieldset');
          const inputs = Dimensions.getInputValues(fieldSet);
          const model = DimensionsModel.getFromStringInputs(inputs, currentUser.isMetric);
          
          const stored = await storage.getDimensionsModelAsync(deviceId);
          if (!stored) {
            await storage.addDimensionsAsync(model, deviceId);
          } else {
            await storage.setDimensionsAsync(model, stored.id, deviceId);
          }
          
          if (!allDimensions) {
            allDimensions = {};
          }
          allDimensions[deviceId] = model;
          
          const vm = model.getViewModelWithUnits(currentUser.isMetric, state);
          comment.querySelector('.secondaryData').textContent = getDimensionsString(vm);
          
          form.classList.add('hidden');
          comment.classList.remove('hidden');
        } catch (e) {
          console.error('Error saving:', e);
        }
        
        saveBtn.disabled = false;
        saveBtn.textContent = state.translate('Apply Changes');
      };
    }
  }

  function showLoadingIndicator(show, message) {
    message = message || 'Loading...';
    let loader = document.getElementById('sygic-loader');
    if (show) {
      if (!loader) {
        const list = document.getElementById('sygic-vehicle-list');
        const html = '<li id="sygic-loader" style="text-align:center;padding:20px;list-style:none;">' +
          '<div class="sygic-spinner"></div>' +
          '<span>' + message + '</span>' +
        '</li>';
        list.insertAdjacentHTML('beforeend', html);
      } else {
        loader.querySelector('span').textContent = message;
      }
    } else if (loader) {
      loader.remove();
    }
  }

  function updateStatus(loaded) {
    let status = document.getElementById('sygic-status');
    if (status) {
      status.textContent = loaded + ' vehicles loaded';
    }
  }

  async function fetchDevicesPage(fromIndex, pageSize) {
    const results = await geotabApi.callAsync('Get', {
      typeName: 'Device',
      search: {
        groups: state.getGroupFilter(),
        fromIndex: fromIndex,
        maxResults: pageSize,
      },
    });
    return results || [];
  }

  async function loadNextPage() {
    if (isLoading || !hasMoreData) {
      return;
    }
    
    isLoading = true;
    var loadingMsg = 'Loading vehicles ' + (totalDevicesLoaded + 1) + ' - ' + (totalDevicesLoaded + PAGE_SIZE) + '...';
    showLoadingIndicator(true, loadingMsg);

    try {
      const devices = await fetchDevicesPage(currentFromIndex, PAGE_SIZE);
      
      if (devices.length === 0) {
        hasMoreData = false;
        showLoadingIndicator(false);
        isLoading = false;
        return;
      }

      if (devices.length < PAGE_SIZE) {
        hasMoreData = false;
      }

      devices.forEach(function(device) {
        device.groups.forEach(function(g) {
          g.name = groupMap[g.id] || g.id;
        });
      });

      const list = document.getElementById('sygic-vehicle-list');
      const loader = document.getElementById('sygic-loader');
      const fragment = document.createDocumentFragment();
      const tempDiv = document.createElement('div');
      
      devices.forEach(function(device) {
        tempDiv.innerHTML = createDeviceHTML(device);
        const li = tempDiv.firstElementChild;
        const row = li.querySelector('.sygic-vehicle');
        if (row) {
          attachEventsToRow(row);
        }
        fragment.appendChild(li);
      });

      if (loader) {
        list.insertBefore(fragment, loader);
      } else {
        list.appendChild(fragment);
      }

      currentFromIndex += devices.length;
      totalDevicesLoaded += devices.length;
      updateStatus(totalDevicesLoaded);

      if (!hasMoreData) {
        showLoadingIndicator(false);
      }

    } catch (error) {
      console.error('Error loading devices:', error);
      showLoadingIndicator(false);
    }

    isLoading = false;
  }

  function setupInfiniteScroll() {
    const container = document.querySelector('.checkmateListBuilder');
    const scrollTarget = container || window;

    const onScroll = _.throttle(function() {
      if (isLoading || !hasMoreData) {
        return;
      }

      let scrollTop, scrollHeight, clientHeight;
      
      if (scrollTarget === window) {
        scrollTop = window.scrollY;
        scrollHeight = document.documentElement.scrollHeight;
        clientHeight = window.innerHeight;
      } else {
        scrollTop = container.scrollTop;
        scrollHeight = container.scrollHeight;
        clientHeight = container.clientHeight;
      }

      if (scrollTop + clientHeight >= scrollHeight - 300) {
        loadNextPage();
      }
    }, 150);

    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    elAddin._scrollCleanup = function() {
      scrollTarget.removeEventListener('scroll', onScroll);
    };
  }

  async function loadStaticData() {
    const [groups, dimensions, session] = await Promise.all([
      geotabApi.callAsync('Get', { typeName: 'Group' }),
      storage.getAllDimensionsModelsAsync(),
      geotabApi.getSessionAsync(),
    ]);

    groupMap = {};
    groups.forEach(function(g) {
      groupMap[g.id] = g.name || g.id;
    });

    allDimensions = dimensions;

    const [users, clearances] = await Promise.all([
      geotabApi.callAsync('Get', { typeName: 'User', search: { name: session.userName } }),
      geotabApi.callAsync('Get', { typeName: 'Group', search: { id: 'groupSecurityId' } }),
    ]);

    currentUser = new User(users[0], clearances);
  }

  function initUI() {
    const list = document.getElementById('sygic-vehicle-list');
    list.innerHTML = '';

    const header = document.querySelector('.geotabPageHeader');
    if (!document.getElementById('sygic-status')) {
      const status = document.createElement('span');
      status.id = 'sygic-status';
      status.style.cssText = 'font-size:13px;color:#666;margin-left:12px;';
      status.textContent = '0 vehicles loaded';
      header.querySelector('h1').appendChild(status);
    }

    currentFromIndex = 0;
    totalDevicesLoaded = 0;
    hasMoreData = true;
    isLoading = false;
  }

  function addStyles() {
    if (document.getElementById('sygic-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'sygic-styles';
    style.textContent = '.sygic-spinner{width:24px;height:24px;border:3px solid #e0e0e0;' +
      'border-top-color:#1a73e8;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 8px}' +
      '@keyframes spin{to{transform:rotate(360deg)}}#sygic-vehicle-list{padding:0;margin:0}';
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

    focus: async function () {
      elAddin.className = '';
      
      const list = document.getElementById('sygic-vehicle-list');
      list.innerHTML = '<li style="text-align:center;padding:40px;list-style:none;">' +
        '<div class="sygic-spinner"></div><span>Initializing...</span></li>';

      try {
        await loadStaticData();
        initUI();
        setupInfiniteScroll();
        await loadNextPage();
      } catch (error) {
        console.error('Init error:', error);
        list.innerHTML = '<li style="color:red;padding:20px;">Error loading. Please refresh.</li>';
      }
    },

    blur: function () {
      elAddin.className += ' hidden';
      if (elAddin._scrollCleanup) {
        elAddin._scrollCleanup();
        elAddin._scrollCleanup = null;
      }
      currentFromIndex = 0;
      totalDevicesLoaded = 0;
      hasMoreData = true;
      isLoading = false;
    },
  };
};