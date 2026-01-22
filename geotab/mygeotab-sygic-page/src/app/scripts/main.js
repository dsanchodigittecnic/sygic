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
    
    // Configuración
    var PAGE_SIZE = 50;
    var isLoading = false;
    var hasMoreData = true;
    var lastDeviceId = null;
    
    // Estado
    var allDimensions = {}; 
    var currentUser = null;
    var storage = null;
    var groupMap = {};
    var totalDevicesLoaded = 0;
    var geotabApi = ApiWrapper(api);

    // Template optimizado
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
                            '<div class="geotabField">' +
                                '<label><%= dimension.label %></label>' +
                                '<% if (dimension.options) { %>' +
                                    '<select name="sygic-truck-dimensions-<%= dimension.key %>" class="geotabFormEditField">' +
                                        '<% _.each(dimension.options, function(option, key) { %>' +
                                            '<option value="<%= key %>" <%= dimension.value === key ? "selected" : "" %>><%= option %></option>' +
                                        '<% }); %>' +
                                    '</select>' +
                                '<% } else { %>' +
                                    '<input type="number" step="0.1" name="sygic-truck-dimensions-<%= dimension.key %>" class="geotabFormEditField" value="<%= dimension.value %>" />' +
                                '<% } %>' +
                            '</div>' +
                        '<% } %>' +
                    '<% }); %>' +
                    '<button class="geotabButton sygic-vehicle-dimensions-save"><%= apply_changes %></button>' +
                '</fieldset>' +
            '</div>' +
        '</div>' +
    '</li>';

    var compiledTemplate = _.template(templateString);

    // --- FUNCIONES DE LÓGICA ---

    function getDimensionsString(viewModel) {
        var parts = [];
        for (var key in viewModel) {
            if (viewModel.hasOwnProperty(key) && key !== 'hazmat') {
                var model = viewModel[key];
                if (model.value !== undefined && model.value !== null && model.value !== '') {
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

        return compiledTemplate({
            vehicle: device,
            vehicle_dimensions_string: getDimensionsString(viewModel),
            vehicle_groups_string: device.groups.map(function(g) { return g.name || groupMap[g.id] || g.id; }).join(', '),
            vehicle_dimensions: dimensionsTemplateObject,
            user: currentUser,
            apply_changes: state.translate('Apply Changes')
        });
    }

    // --- EVENTOS (Delegación para mayor velocidad) ---

    function setupGlobalEvents() {
        var list = document.getElementById('sygic-vehicle-list');
        list.onclick = async function(e) {
            var target = e.target.closest('a, button');
            if (!target) return;

            var row = target.closest('.sygic-vehicle-row');
            var deviceId = row.dataset.deviceId;

            // Toggle Formulario
            if (target.classList.contains('sygic-edit-dimensions')) {
                e.preventDefault();
                row.querySelector('.sygic-vehicle-dimensions-form').classList.toggle('hidden');
                row.querySelector('.vehicle-dimensions-comment').classList.toggle('hidden');
            }

            // Guardar
            if (target.classList.contains('sygic-vehicle-dimensions-save')) {
                target.disabled = true;
                var originalText = target.textContent;
                target.textContent = 'Saving...';

                try {
                    var fieldSet = row.querySelector('.sygic-vehicle-dimensions-fieldset');
                    var inputs = Dimensions.getInputValues(fieldSet);
                    var model = DimensionsModel.getFromStringInputs(inputs, currentUser.isMetric);

                    // Guardar en Geotab/Storage
                    await storage.setDimensionsAsync(model, null, deviceId);
                    allDimensions[deviceId] = model;

                    // Actualizar UI de la fila sin recargar todo
                    var vm = model.getViewModelWithUnits(currentUser.isMetric, state);
                    row.querySelector('.vehicle-dimensions-comment .secondaryData').textContent = getDimensionsString(vm);
                    row.querySelector('.sygic-vehicle-dimensions-form').classList.add('hidden');
                    row.querySelector('.vehicle-dimensions-comment').classList.remove('hidden');
                } catch (err) {
                    console.error('[SYGIC] Error saving:', err);
                }
                target.disabled = false;
                target.textContent = originalText;
            }
        };
    }

    // --- CARGA DE DATOS ---

    async function loadNextPage() {
        if (isLoading || !hasMoreData) return;
        isLoading = true;
        
        var fromNum = totalDevicesLoaded + 1;
        showLoadingIndicator(true, 'Loading vehicles ' + fromNum + '...');

        try {
            var callParams = {
                typeName: 'Device',
                resultsLimit: PAGE_SIZE,
                search: { groups: state.getGroupFilter() },
                sort: { sortBy: 'Id' }
            };
            if (lastDeviceId) callParams.sort.offset = lastDeviceId;

            var devices = await geotabApi.callAsync('Get', callParams);

            if (!devices || devices.length === 0) {
                hasMoreData = false;
            } else {
                lastDeviceId = devices[devices.length - 1].id;
                if (devices.length < PAGE_SIZE) hasMoreData = false;

                // CARGA BAJO DEMANDA: Solo pedimos dimensiones de los IDs que recibimos
                var deviceIds = devices.map(function(d) { return d.id; });
                var pageDims = await storage.getDimensionsModelsAsync(deviceIds);
                Object.assign(allDimensions, pageDims);

                var list = document.getElementById('sygic-vehicle-list');
                var html = devices.map(function(d) { return createDeviceHTML(d); }).join('');
                
                // Insertar en el DOM de forma eficiente
                var tempDiv = document.createElement('div');
                tempDiv.innerHTML = html;
                var fragment = document.createDocumentFragment();
                while (tempDiv.firstChild) {
                    fragment.appendChild(tempDiv.firstChild);
                }

                var loader = document.getElementById('sygic-loader');
                if (loader) list.insertBefore(fragment, loader);
                else list.appendChild(fragment);

                totalDevicesLoaded += devices.length;
                updateStatus(totalDevicesLoaded);
            }
        } catch (error) {
            console.error('[SYGIC] Load error:', error);
        }

        isLoading = false;
        showLoadingIndicator(false);
    }

    // --- UTILIDADES ---

    function showLoadingIndicator(show, message) {
        var loader = document.getElementById('sygic-loader');
        if (show) {
            if (!loader) {
                var html = '<li id="sygic-loader" style="text-align:center;padding:20px;list-style:none;">' +
                    '<div class="sygic-spinner"></div><span>' + (message || 'Loading...') + '</span></li>';
                document.getElementById('sygic-vehicle-list').insertAdjacentHTML('beforeend', html);
            } else {
                loader.querySelector('span').textContent = message;
            }
        } else if (loader) {
            loader.remove();
        }
    }

    function updateStatus(loaded) {
        var status = document.getElementById('sygic-status');
        if (status) status.textContent = loaded + ' vehicles loaded';
    }

    function setupInfiniteScroll() {
        var container = document.querySelector('.checkmateListBuilder') || window;
        var onScroll = _.throttle(function() {
            if (isLoading || !hasMoreData) return;
            var scrollTop = container === window ? window.scrollY : container.scrollTop;
            var scrollHeight = container === window ? document.documentElement.scrollHeight : container.scrollHeight;
            var clientHeight = container === window ? window.innerHeight : container.clientHeight;

            if (scrollHeight - scrollTop - clientHeight < 400) {
                loadNextPage();
            }
        }, 200);

        container.addEventListener('scroll', onScroll, { passive: true });
        elAddin._scrollCleanup = function() { container.removeEventListener('scroll', onScroll); };
    }

    function addStyles() {
        if (document.getElementById('sygic-styles')) return;
        var style = document.createElement('style');
        style.id = 'sygic-styles';
        style.textContent = '.sygic-spinner{width:24px;height:24px;border:3px solid #e0e0e0;border-top-color:#1a73e8;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 8px}@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(style);
    }

    return {
        initialize: function(freshApi, freshState, callback) {
            addStyles();
            storage = new DimensionsStorage(ApiWrapper(freshApi));
            callback();
        },

        focus: async function() {
            elAddin.className = '';
            var list = document.getElementById('sygic-vehicle-list');
            list.innerHTML = '<li style="text-align:center;padding:40px;list-style:none;"><div class="sygic-spinner"></div></li>';

            try {
                // Carga inicial de datos estáticos (Garantiza que no traemos miles de dimensiones aquí)
                var session = await geotabApi.getSessionAsync();
                var results = await Promise.all([
                    geotabApi.callAsync('Get', { typeName: 'Group' }),
                    geotabApi.callAsync('Get', { typeName: 'User', search: { name: session.userName } }),
                    geotabApi.callAsync('Get', { typeName: 'Group', search: { id: 'groupSecurityId' } })
                ]);

                results[0].forEach(function(g) { groupMap[g.id] = g.name || g.id; });
                currentUser = new User(results[1][0], results[2]);

                list.innerHTML = ''; // Limpiar spinner inicial
                totalDevicesLoaded = 0;
                lastDeviceId = null;
                hasMoreData = true;

                if (!document.getElementById('sygic-status')) {
                    var h1 = document.querySelector('.geotabPageHeader h1');
                    var status = document.createElement('span');
                    status.id = 'sygic-status';
                    status.style.cssText = 'font-size:13px;color:#666;margin-left:12px;font-weight:normal;';
                    h1.appendChild(status);
                }

                setupGlobalEvents();
                setupInfiniteScroll();
                await loadNextPage();
            } catch (err) {
                console.error(err);
                list.innerHTML = '<li style="padding:20px;color:red;">Error loading data.</li>';
            }
        },

        blur: function() {
            if (elAddin._scrollCleanup) elAddin._scrollCleanup();
        }
    };
};