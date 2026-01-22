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
    var PAGE_SIZE = 50; 
    var isLoading = false;
    var hasMoreData = true;
    var lastDeviceId = null;
    
    var allDimensions = {}; 
    var currentUser = null;
    var storage = null;
    var groupMap = {};
    var totalDevicesLoaded = 0;
    var geotabApi = ApiWrapper(api);

    // Template compilado una sola vez para ahorrar CPU
    var templateString = '<li class="sygic-vehicle-row" data-device-id="<%= vehicle.id %>">' +
        '<div class="g-col checkmateListBuilderRow sygic-vehicle">' +
            '<div class="g-row">' +
                '<div class="g-main g-main-col g-main_wider">' +
                    '<div class="g-name"><span class="ellipsis"><%= vehicle.name %></span></div>' +
                    '<div class="g-comment"><div class="secondaryData ellipsis"><%= vehicle_groups_string %></div></div>' +
                    '<div class="g-comment vehicle-dimensions-comment"><div class="secondaryData ellipsis"><%= vehicle_dimensions_string %></div></div>' +
                '</div>' +
                '<div class="g-ctrl">' +
                    '<a href="#" class="geotabButton geotabButton-empty sygic-edit-dimensions<%= user.canModify ? "" : " hidden" %>">' +
                        '<svg class="svgIcon geotabButtonIcons"><use xlink:href="#geo-pencil-icon"></use></svg>' +
                    '</a>' +
                '</div>' +
            '</div>' +
            '<div class="g-row hidden sygic-vehicle-dimensions-form">' +
                '<fieldset class="geotabFieldset sygic-vehicle-dimensions-fieldset" style="background-color: transparent">' +
                    '<% _.each(vehicle_dimensions, function(dim) { %>' +
                        '<div class="geotabField">' +
                            '<label><%= dim.label %></label>' +
                            '<% if (dim.options) { %>' +
                                '<select name="sygic-truck-dimensions-<%= dim.key %>" class="geotabFormEditField">' +
                                    '<% _.each(dim.options, function(opt, k) { %>' +
                                        '<option value="<%= k %>" <%= dim.value === k ? "selected" : "" %>><%= opt %></option>' +
                                    '<% }); %>' +
                                '</select>' +
                            '<% } else { %>' +
                                '<input type="number" step="0.1" name="sygic-truck-dimensions-<%= dim.key %>" class="geotabFormEditField" value="<%= dim.value %>" />' +
                            '<% } %>' +
                        '</div>' +
                    '<% }); %>' +
                    '<button class="geotabButton sygic-vehicle-dimensions-save"><%= apply_changes %></button>' +
                '</fieldset>' +
            '</div>' +
        '</div>' +
    '</li>';

    var compiledTemplate = _.template(templateString);

function getDimensionsString(viewModel) {
    var parts = [];
    for (var key in viewModel) {
        // Reemplazamos viewModel[key]?.value por una validación tradicional
        if (key !== 'hazmat' && viewModel.hasOwnProperty(key)) {
            var model = viewModel[key];
            if (model && (model.value !== undefined && model.value !== null && model.value !== '')) {
                var val = (key === 'routing_type') 
                    ? DimensionsModel.getRoutingTypeString(model.value, state) 
                    : model.value;
                parts.push(model.label + ': ' + val);
            }
        }
    }
    return parts.length > 0 ? parts.join(', ') : 'Dimensions unset';
}

    // CARGA POR LOTES (Chunking): Procesa el HTML en partes para no congelar el navegador
    async function renderInChunks(devices) {
        var list = document.getElementById('sygic-vehicle-list');
        var loader = document.getElementById('sygic-loader');

        // Procesamos de 10 en 10 para que la UI respire
        for (var i = 0; i < devices.length; i += 10) {
            var chunk = devices.slice(i, i + 10);
            var html = chunk.map(function(device) {
                return createDeviceHTML(device);
            }).join('');

            var temp = document.createElement('div');
            temp.innerHTML = html;
            while (temp.firstChild) {
                list.insertBefore(temp.firstChild, loader);
            }
            // Pequeña pausa de 10ms para permitir que el navegador pinte la UI
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    function createDeviceHTML(device) {
        var viewModel = allDimensions[device.id] 
            ? allDimensions[device.id].getViewModelWithUnits(currentUser.isMetric, state)
            : DimensionsModel.getEmptyViewModel(currentUser.isMetric, state);

        return compiledTemplate({
            vehicle: device,
            vehicle_dimensions_string: getDimensionsString(viewModel),
            vehicle_groups_string: device.groups.map(g => groupMap[g.id] || g.name || g.id).join(', '),
            vehicle_dimensions: Object.keys(viewModel).filter(k => k !== 'hazmat').map(k => ({
                value: viewModel[k].value, key: k, label: viewModel[k].label, options: viewModel[k].options
            })),
            user: currentUser,
            apply_changes: state.translate('Apply Changes')
        });
    }

    async function loadNextPage() {
        if (isLoading || !hasMoreData) return;
        isLoading = true;
        showLoadingIndicator(true, 'Fetching data...');

        try {
            // FUERZA LA PAGINACIÓN: Si lastDeviceId existe, lo usamos estrictamente
            var callParams = {
                typeName: 'Device',
                resultsLimit: PAGE_SIZE,
                search: { groups: state.getGroupFilter() }
            };

            if (lastDeviceId) {
                callParams.search.id = lastDeviceId; // Algunos servidores Geotab prefieren esto
                callParams.sort = { sortBy: 'Id', offset: lastDeviceId };
            }

            var devices = await geotabApi.callAsync('Get', callParams);

            if (!devices || devices.length === 0) {
                hasMoreData = false;
            } else {
                // Si el servidor ignora el PAGE_SIZE y manda 1000, nosotros cortamos a 50
                var batch = devices.slice(0, PAGE_SIZE);
                lastDeviceId = batch[batch.length - 1].id;
                
                if (devices.length < PAGE_SIZE) hasMoreData = false;

                // Solo pedimos dimensiones para este lote
                var deviceIds = batch.map(d => d.id);
                var pageDims = await storage.getDimensionsModelsAsync(deviceIds);
                Object.assign(allDimensions, pageDims);

                await renderInChunks(batch);

                totalDevicesLoaded += batch.length;
                updateStatus(totalDevicesLoaded);
            }
        } catch (error) {
            console.error('[SYGIC] Error:', error);
        }

        isLoading = false;
        showLoadingIndicator(false);
    }

    function setupGlobalEvents() {
        var list = document.getElementById('sygic-vehicle-list');
        list.addEventListener('click', async function(e) {
            var target = e.target.closest('a, button');
            if (!target) return;

            var row = target.closest('.sygic-vehicle-row');
            var deviceId = row.dataset.deviceId;

            if (target.classList.contains('sygic-edit-dimensions')) {
                e.preventDefault();
                row.querySelector('.sygic-vehicle-dimensions-form').classList.toggle('hidden');
                row.querySelector('.vehicle-dimensions-comment').classList.toggle('hidden');
            }

            if (target.classList.contains('sygic-vehicle-dimensions-save')) {
                target.disabled = true;
                try {
                    var fieldSet = row.querySelector('.sygic-vehicle-dimensions-fieldset');
                    var inputs = Dimensions.getInputValues(fieldSet);
                    var model = DimensionsModel.getFromStringInputs(inputs, currentUser.isMetric);
                    
                    await storage.setDimensionsAsync(model, null, deviceId);
                    allDimensions[deviceId] = model;

                    var vm = model.getViewModelWithUnits(currentUser.isMetric, state);
                    row.querySelector('.secondaryData').textContent = getDimensionsString(vm);
                    row.querySelector('.sygic-vehicle-dimensions-form').classList.add('hidden');
                    row.querySelector('.vehicle-dimensions-comment').classList.remove('hidden');
                } catch (err) { console.error(err); }
                target.disabled = false;
            }
        });
    }

    // --- Auxiliares ---
    function showLoadingIndicator(show, msg) {
        var loader = document.getElementById('sygic-loader');
        if (show && !loader) {
            document.getElementById('sygic-vehicle-list').insertAdjacentHTML('beforeend', 
                '<li id="sygic-loader" style="text-align:center;padding:20px;list-style:none;"><div class="sygic-spinner"></div><span>'+msg+'</span></li>');
        } else if (!show && loader) loader.remove();
    }

    function updateStatus(n) {
        var s = document.getElementById('sygic-status');
        if (s) s.textContent = n + ' vehicles loaded';
    }

    function setupInfiniteScroll() {
        var scrollContainer = document.querySelector('.checkmateListBuilder') || window;
        scrollContainer.addEventListener('scroll', _.throttle(function() {
            if (isLoading || !hasMoreData) return;
            var containerHeight = scrollContainer === window ? document.documentElement.scrollHeight : scrollContainer.scrollHeight;
            var currentScroll = scrollContainer === window ? window.scrollY + window.innerHeight : scrollContainer.scrollTop + scrollContainer.clientHeight;
            if (containerHeight - currentScroll < 400) loadNextPage();
        }, 300));
    }

    return {
        initialize: function(api, state, callback) {
            storage = new DimensionsStorage(ApiWrapper(api));
            callback();
        },
        focus: async function() {
            elAddin.className = '';
            document.getElementById('sygic-vehicle-list').innerHTML = '';
            
            // Paso 1: Carga rápida de sesión y grupos
            var session = await geotabApi.getSessionAsync();
            var groups = await geotabApi.callAsync('Get', { typeName: 'Group' });
            groups.forEach(g => groupMap[g.id] = g.name || g.id);

            // Paso 2: Usuario
            var userRes = await geotabApi.callAsync('Get', { typeName: 'User', search: { name: session.userName } });
            currentUser = new User(userRes[0]);

            // Paso 3: Iniciar UI y primera página
            setupGlobalEvents();
            setupInfiniteScroll();
            await loadNextPage();
        },
        blur: function() {}
    };
};