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
    
    // VARIABLES DE CONTROL CRÍTICAS
    var deviceBuffer = []; // Aquí guardaremos el exceso si Geotab ignora el límite
    var allDimensions = {};
    var currentUser = null;
    var storage = null;
    var groupMap = {};
    var totalDevicesLoaded = 0;
    var geotabApi = ApiWrapper(api);

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

    // Corregido para evitar el error de "Unexpected token ." en el build
    function getDimensionsString(viewModel) {
        var parts = [];
        for (var key in viewModel) {
            if (viewModel.hasOwnProperty(key) && key !== 'hazmat') {
                var model = viewModel[key];
                if (model && model.value !== undefined && model.value !== null && model.value !== '') {
                    var val = (key === 'routing_type') 
                        ? DimensionsModel.getRoutingTypeString(model.value, state) 
                        : model.value;
                    parts.push(model.label + ': ' + val);
                }
            }
        }
        return parts.length > 0 ? parts.join(', ') : 'Dimensions unset';
    }

    function createDeviceHTML(device) {
        var viewModel = allDimensions[device.id] 
            ? allDimensions[device.id].getViewModelWithUnits(currentUser.isMetric, state)
            : DimensionsModel.getEmptyViewModel(currentUser.isMetric, state);

        return compiledTemplate({
            vehicle: device,
            vehicle_dimensions_string: getDimensionsString(viewModel),
            vehicle_groups_string: device.groups.map(function(g) { return groupMap[g.id] || g.name || g.id; }).join(', '),
            vehicle_dimensions: Object.keys(viewModel).filter(function(k) { return k !== 'hazmat'; }).map(function(k) {
                return { value: viewModel[k].value, key: k, label: viewModel[k].label, options: viewModel[k].options };
            }),
            user: currentUser,
            apply_changes: state.translate('Apply Changes')
        });
    }

    async function loadNextPage() {
        if (isLoading) return;
        isLoading = true;

        var list = document.getElementById('sygic-vehicle-list');
        showLoadingIndicator(true, 'Cargando bloque...');

        try {
            var devicesToRender = [];

            // ESTRATEGIA: Si tenemos datos en el buffer (porque la API mandó de más), los usamos primero
            if (deviceBuffer.length > 0) {
                devicesToRender = deviceBuffer.splice(0, PAGE_SIZE);
            } else if (hasMoreData) {
                // Si el buffer está vacío, llamamos a la API
                var callParams = {
                    typeName: 'Device',
                    resultsLimit: PAGE_SIZE, // El servidor suele ignorar esto en búsquedas de grupos
                    search: { groups: state.getGroupFilter() }
                };

                var results = await geotabApi.callAsync('Get', callParams);
                
                if (!results || results.length === 0) {
                    hasMoreData = false;
                } else {
                    // Si el API nos mandó 1000, guardamos 950 en el buffer y renderizamos solo 50
                    devicesToRender = results.slice(0, PAGE_SIZE);
                    if (results.length > PAGE_SIZE) {
                        deviceBuffer = results.slice(PAGE_SIZE);
                    }
                    // Si mandó menos del límite, ya no hay más datos que pedir al servidor
                    if (results.length < PAGE_SIZE) hasMoreData = false;
                }
            }

            if (devicesToRender.length > 0) {
                // Pedimos dimensiones solo para los 50 que vamos a mostrar ahora
                var ids = devicesToRender.map(function(d) { return d.id; });
                var dims = await storage.getDimensionsModelsAsync(ids);
                Object.assign(allDimensions, dims);

                // Renderizado por micro-lotes para que no se congele el navegador
                for (var i = 0; i < devicesToRender.length; i += 10) {
                    var chunk = devicesToRender.slice(i, i + 10);
                    var html = chunk.map(function(d) { return createDeviceHTML(d); }).join('');
                    var temp = document.createElement('div');
                    temp.innerHTML = html;
                    var fragment = document.createDocumentFragment();
                    while (temp.firstChild) fragment.appendChild(temp.firstChild);
                    
                    var loader = document.getElementById('sygic-loader');
                    list.insertBefore(fragment, loader);
                    
                    // Pausa de 16ms (1 frame) para que la UI respire
                    await new Promise(function(resolve) { setTimeout(resolve, 16); });
                }

                totalDevicesLoaded += devicesToRender.length;
                updateStatus(totalDevicesLoaded);
            }

        } catch (error) {
            console.error('[SYGIC] Error:', error);
        }

        isLoading = false;
        showLoadingIndicator(false);
    }

    // --- REESTABLECER EL RESTO DE FUNCIONES (GlobalEvents, Scroll, etc) ---

    function setupGlobalEvents() {
        var list = document.getElementById('sygic-vehicle-list');
        list.onclick = async function(e) {
            var target = e.target.closest('a, button');
            if (!target) return;
            var row = target.closest('.sygic-vehicle-row');
            if (target.classList.contains('sygic-edit-dimensions')) {
                e.preventDefault();
                row.querySelector('.sygic-vehicle-dimensions-form').classList.toggle('hidden');
                row.querySelector('.vehicle-dimensions-comment').classList.toggle('hidden');
            }
            if (target.classList.contains('sygic-vehicle-dimensions-save')) {
                target.disabled = true;
                try {
                    var fieldSet = row.querySelector('.sygic-vehicle-dimensions-fieldset');
                    var model = DimensionsModel.getFromStringInputs(Dimensions.getInputValues(fieldSet), currentUser.isMetric);
                    await storage.setDimensionsAsync(model, null, row.dataset.deviceId);
                    allDimensions[row.dataset.deviceId] = model;
                    row.querySelector('.secondaryData').textContent = getDimensionsString(model.getViewModelWithUnits(currentUser.isMetric, state));
                    row.querySelector('.sygic-vehicle-dimensions-form').classList.add('hidden');
                    row.querySelector('.vehicle-dimensions-comment').classList.remove('hidden');
                } catch (err) { console.error(err); }
                target.disabled = false;
            }
        };
    }

    function setupInfiniteScroll() {
        var container = document.querySelector('.checkmateListBuilder') || window;
        var onScroll = _.throttle(function() {
            if (isLoading) return;
            // Si hay buffer o hay más datos en el server, cargamos
            if (deviceBuffer.length > 0 || hasMoreData) {
                var st = container === window ? window.scrollY : container.scrollTop;
                var sh = container === window ? document.documentElement.scrollHeight : container.scrollHeight;
                var ch = container === window ? window.innerHeight : container.clientHeight;
                if (sh - st - ch < 600) loadNextPage();
            }
        }, 300);
        container.addEventListener('scroll', onScroll, { passive: true });
    }

    function showLoadingIndicator(show, msg) {
        var loader = document.getElementById('sygic-loader');
        if (show && !loader) {
            document.getElementById('sygic-vehicle-list').insertAdjacentHTML('beforeend', '<li id="sygic-loader" style="text-align:center;padding:20px;list-style:none;"><div class="sygic-spinner"></div><span>'+msg+'</span></li>');
        } else if (!show && loader) loader.remove();
    }

    function updateStatus(n) {
        var s = document.getElementById('sygic-status');
        if (s) s.textContent = n + ' vehículos mostrados';
    }

    return {
        initialize: function(api, freshState, callback) {
            storage = new DimensionsStorage(ApiWrapper(api));
            callback();
        },
        focus: async function() {
            elAddin.className = '';
            document.getElementById('sygic-vehicle-list').innerHTML = '';
            deviceBuffer = []; // Resetear buffer al entrar
            
            var session = await geotabApi.getSessionAsync();
            var res = await Promise.all([
                geotabApi.callAsync('Get', { typeName: 'Group' }),
                geotabApi.callAsync('Get', { typeName: 'User', search: { name: session.userName } })
            ]);
            res[0].forEach(function(g) { groupMap[g.id] = g.name || g.id; });
            currentUser = new User(res[1][0]);

            setupGlobalEvents();
            setupInfiniteScroll();
            await loadNextPage();
        },
        blur: function() {}
    };
};