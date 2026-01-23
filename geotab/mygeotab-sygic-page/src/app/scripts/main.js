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
  var allDimensions = null;
  var currentUser = null;
  var storage = null;
  var groupMap = {};

  var geotabApi = ApiWrapper(api);

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

  function showLoading(show, message) {
    var list = document.getElementById('sygic-vehicle-list');
    if (show) {
      message = message || 'Loading...';
      list.innerHTML = '<li style="text-align:center;padding:40px;list-style:none;">' +
        '<div class="sygic-spinner"></div><span>' + message + '</span></li>';
    }
  }

  function renderAllDevices() {
    var list = document.getElementById('sygic-vehicle-list');
    list.innerHTML = '';

    var fragment = document.createDocumentFragment();
    var tempDiv = document.createElement('div');

    allDevices.forEach(function(device) {
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
      '#sygic-vehicle-list{padding:0;margin:0}';

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
      fields: ['id', 'name', 'groups'],
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
      showLoading(true, 'Loading...');

      try {
        await loadGroups();
        await loadDimensions();
        var session = await loadSession();
        await loadUser(session.userName);
        await loadDevices();
        
        renderAllDevices();
        
      } catch (error) {
        console.error('[SYGIC] ERROR:', error);
        var list = document.getElementById('sygic-vehicle-list');
        list.innerHTML = '<li style="color:red;padding:20px;">Error: ' + error + '</li>';
      }
    },

    blur: function() {
      elAddin.className += ' hidden';
      allDevices = [];
    }
  };
};