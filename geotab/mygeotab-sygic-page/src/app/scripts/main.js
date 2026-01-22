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

    // ... (mismo encabezado y variables que el anterior)

async function loadNextPage() {
    if (isLoading || !hasMoreData) return;
    isLoading = true;

    var list = document.getElementById('sygic-vehicle-list');
    showLoadingIndicator(true, 'Cargando vehículos...');

    try {
        // 1. OBTENER SÓLO LOS IDs (Esto es instantáneo incluso para 5,000 vehículos)
        // Solo lo hacemos la primera vez para saber qué vehículos existen
        if (totalDevicesLoaded === 0 && deviceBuffer.length === 0) {
            var allIds = await geotabApi.callAsync('Get', {
                typeName: 'Device',
                search: { groups: state.getGroupFilter() },
                propertySelector: ['id'] // <--- CRÍTICO: Solo pedimos el ID, no todo el objeto
            });
            deviceBuffer = allIds || [];
            console.log('[SYGIC] Total de IDs encontrados:', deviceBuffer.length);
        }

        // 2. EXTRAER EL SIGUIENTE LOTE DE LA MOCHILA (Buffer)
        var batchIds = deviceBuffer.splice(0, PAGE_SIZE);
        
        if (batchIds.length === 0) {
            hasMoreData = false;
        } else {
            // 3. PEDIR DATOS COMPLETOS SÓLO PARA LOS 50 IDs ACTUALES
            // Esto garantiza que Geotab solo devuelva 50 objetos completos
            var devicesToRender = await geotabApi.callAsync('Get', {
                typeName: 'Device',
                search: {
                    id: batchIds.map(function(d) { return d.id; })
                }
            });

            // 4. PEDIR DIMENSIONES SÓLO PARA ESTOS 50
            var dims = await storage.getDimensionsModelsAsync(batchIds.map(function(d) { return d.id; }));
            Object.assign(allDimensions, dims);

            // 5. RENDERIZADO CONTROLADO (Para no bloquear la UI)
            for (var i = 0; i < devicesToRender.length; i++) {
                var device = devicesToRender[i];
                var html = createDeviceHTML(device);
                var temp = document.createElement('div');
                temp.innerHTML = html;
                
                var loader = document.getElementById('sygic-loader');
                list.insertBefore(temp.firstElementChild, loader);
                
                // Si el lote es muy grande, pausamos cada 10 para mantener 60fps
                if (i % 10 === 0) {
                    await new Promise(function(resolve) { setTimeout(resolve, 1); });
                }
            }

            totalDevicesLoaded += devicesToRender.length;
            updateStatus(totalDevicesLoaded);
        }

    } catch (error) {
        console.error('[SYGIC] Error crítico en carga:', error);
    }

    isLoading = false;
    showLoadingIndicator(false);
}

// ... (Resto de funciones auxiliares del código anterior)

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