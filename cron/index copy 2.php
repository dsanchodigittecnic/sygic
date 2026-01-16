<?php

/**
 * Script para recuperar todas las Routes de Geotab del día de hoy
 * con los puntos (RoutePlanItems y Zones) de cada ruta
 */

class GeotabAPI {
    private string $server;
    private array $credentials;
    
    public function __construct(string $database, string $username, string $password, string $server = 'my.geotab.com') {
        $this->server = $server;
        $this->credentials = [
            'database' => $database,
            'userName' => $username,
            'password' => $password
        ];
    }
    
    public function authenticate(): array {
        $params = [
            'method' => 'Authenticate',
            'params' => $this->credentials
        ];
        
        $response = $this->makeRequest($params);
        
        if (isset($response['result'])) {
            $this->credentials = $response['result']['credentials'];
            
            $newServer = $response['result']['path'] ?? null;
            if ($newServer && $newServer !== 'ThisServer' && filter_var("https://$newServer", FILTER_VALIDATE_URL)) {
                $this->server = $newServer;
            }
            
            return $response['result'];
        }
        
        throw new Exception('Error de autenticación: ' . json_encode($response));
    }
    
    public function getServer(): string {
        return $this->server;
    }
    
    public function call(string $method, array $params = []): array {
        $requestParams = [
            'method' => $method,
            'params' => array_merge(['credentials' => $this->credentials], $params)
        ];
        
        return $this->makeRequest($requestParams);
    }
    
    /**
     * Ejecuta múltiples llamadas en una sola petición (más eficiente)
     */
    public function multiCall(array $calls): array {
        $requestParams = [
            'method' => 'ExecuteMultiCall',
            'params' => [
                'credentials' => $this->credentials,
                'calls' => $calls
            ]
        ];
        
        return $this->makeRequest($requestParams);
    }
    
    private function makeRequest(array $data): array {
        $url = "https://{$this->server}/apiv1";
        
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => json_encode($data),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json'
            ],
            CURLOPT_TIMEOUT => 120
        ]);
        
        $response = curl_exec($ch);
        
        if (curl_errno($ch)) {
            throw new Exception('Error cURL: ' . curl_error($ch));
        }
        
        curl_close($ch);
        
        $decoded = json_decode($response, true);
        
        if (isset($decoded['error'])) {
            throw new Exception('Error Geotab: ' . json_encode($decoded['error']));
        }
        
        return $decoded;
    }
}

/**
 * Función principal
 */
function main() {
    // ========== CONFIGURACIÓN ==========
    $config = [
        'database' => 'emaya',
        'username' => 'dsancho@digittecnic.com',
        'password' => 'Catalunya4**',
        'server'   => 'my.geotab.com',
        'output_dir' => './geotab_routes_' . date('Y-m-d')
    ];
    
    // Fechas de hoy (UTC)
    $fromDate = (new DateTime('today', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    $toDate = (new DateTime('tomorrow', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    
    echo "===========================================\n";
    echo "  GEOTAB - Exportar Routes con Puntos\n";
    echo "===========================================\n";
    echo "Fecha desde: $fromDate\n";
    echo "Fecha hasta: $toDate\n\n";
    
    try {
        // 1. Conectar y autenticar
        $api = new GeotabAPI(
            $config['database'],
            $config['username'],
            $config['password'],
            $config['server']
        );
        
        echo "🔐 Autenticando...\n";
        $auth = $api->authenticate();
        echo "✅ Autenticación exitosa\n";
        echo "   Servidor: " . $api->getServer() . "\n\n";
        
        // 2. Obtener todos los dispositivos
        echo "🚛 Obteniendo dispositivos...\n";
        $devicesResponse = $api->call('Get', [
            'typeName' => 'Device'
        ]);
        
        $devices = $devicesResponse['result'] ?? [];
        echo "   Dispositivos encontrados: " . count($devices) . "\n\n";
        
        $deviceIndex = [];
        foreach ($devices as $device) {
            $deviceIndex[$device['id']] = $device;
        }
        
        // 3. Obtener todas las Zones (para tener las coordenadas)
        echo "📍 Obteniendo Zones...\n";
        $zonesResponse = $api->call('Get', [
            'typeName' => 'Zone'
        ]);
        
        $zones = $zonesResponse['result'] ?? [];
        echo "   Zones encontradas: " . count($zones) . "\n\n";
        
        // Crear índice de zones por ID
        $zoneIndex = [];
        foreach ($zones as $zone) {
            $zoneIndex[$zone['id']] = $zone;
        }
        
        // 4. Obtener todas las Routes del día de hoy
        echo "🗺️  Obteniendo Routes del día de hoy...\n";
        $routesResponse = $api->call('Get', [
            'typeName' => 'Route',
            'search' => [
                'fromDate' => $fromDate,
                'toDate' => $toDate
            ]
        ]);
        
        $routes = $routesResponse['result'] ?? [];
        echo "   Routes encontradas: " . count($routes) . "\n\n";
        
        if (empty($routes)) {
            echo "⚠️  No se encontraron routes para el día de hoy.\n";
            return;
        }
        
        // 5. Agrupar routes por dispositivo
        $routesByDevice = [];
        $routesWithoutDevice = [];
        
        foreach ($routes as $route) {
            $deviceId = $route['device']['id'] ?? null;
            
            if ($deviceId && $deviceId !== 'NoDeviceId') {
                if (!isset($routesByDevice[$deviceId])) {
                    $routesByDevice[$deviceId] = [];
                }
                $routesByDevice[$deviceId][] = $route;
            } else {
                $routesWithoutDevice[] = $route;
            }
        }
        
        echo "📊 Resumen:\n";
        echo "   - Dispositivos con routes: " . count($routesByDevice) . "\n";
        echo "   - Routes sin dispositivo: " . count($routesWithoutDevice) . "\n\n";
        
        // 6. Crear directorio principal
        if (!is_dir($config['output_dir'])) {
            mkdir($config['output_dir'], 0755, true);
        }
        
        echo "📁 Creando estructura en: {$config['output_dir']}\n\n";
        
        // 7. Procesar cada dispositivo y sus routes
        foreach ($routesByDevice as $deviceId => $deviceRoutes) {
            $device = $deviceIndex[$deviceId] ?? null;
            $deviceName = $device['name'] ?? $deviceId;
            
            $folderName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $deviceName);
            $deviceFolder = $config['output_dir'] . '/' . $folderName;
            
            if (!is_dir($deviceFolder)) {
                mkdir($deviceFolder, 0755, true);
            }
            
            echo "📂 {$deviceName}\n";
            
            // Guardar info del dispositivo
            if ($device) {
                file_put_contents(
                    $deviceFolder . '/device_info.json',
                    json_encode($device, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
                );
            }
            
            // Procesar cada route
            foreach ($deviceRoutes as $index => $route) {
                $routeName = $route['name'] ?? "route_$index";
                $routeFileName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $routeName);
                $routeFile = $deviceFolder . '/' . $routeFileName . '.json';
                
                // Extraer los puntos (RoutePlanItems) con coordenadas
                $waypoints = [];
                $routePlanItems = $route['routePlanItemCollection'] ?? [];
                
                foreach ($routePlanItems as $planItem) {
                    $zoneId = $planItem['zone']['id'] ?? null;
                    $zone = $zoneId ? ($zoneIndex[$zoneId] ?? null) : null;
                    
                    // Calcular centro de la zona (punto central)
                    $centerPoint = null;
                    if ($zone && isset($zone['points']) && !empty($zone['points'])) {
                        $latSum = 0;
                        $lonSum = 0;
                        $count = count($zone['points']);
                        
                        foreach ($zone['points'] as $point) {
                            $latSum += $point['y'] ?? 0;
                            $lonSum += $point['x'] ?? 0;
                        }
                        
                        $centerPoint = [
                            'latitude' => $latSum / $count,
                            'longitude' => $lonSum / $count
                        ];
                    }
                    
                    $waypoints[] = [
                        'sequence' => $planItem['sequence'] ?? $index,
                        'expectedArrival' => $planItem['dateTime'] ?? null,
                        'activeFrom' => $planItem['activeFrom'] ?? null,
                        'activeTo' => $planItem['activeTo'] ?? null,
                        'zone' => [
                            'id' => $zoneId,
                            'name' => $zone['name'] ?? 'Desconocida',
                            'comment' => $zone['comment'] ?? '',
                            'centerPoint' => $centerPoint,
                            'points' => $zone['points'] ?? [],  // Polígono completo
                            'zoneTypes' => $zone['zoneTypes'] ?? []
                        ]
                    ];
                }
                
                // Ordenar por secuencia
                usort($waypoints, fn($a, $b) => ($a['sequence'] ?? 0) <=> ($b['sequence'] ?? 0));
                
                // Estructura completa de la route
                $routeData = [
                    'route' => [
                        'id' => $route['id'],
                        'name' => $route['name'] ?? '',
                        'comment' => $route['comment'] ?? '',
                        'startTime' => $route['startTime'] ?? null,
                        'endTime' => $route['endTime'] ?? null,
                        'routeType' => $route['routeType'] ?? 'Basic'
                    ],
                    'device' => $device ? [
                        'id' => $device['id'],
                        'name' => $device['name'],
                        'serialNumber' => $device['serialNumber'] ?? null
                    ] : null,
                    'waypoints' => $waypoints,
                    'waypointCount' => count($waypoints),
                    'exportDate' => date('Y-m-d H:i:s'),
                    'dateRange' => [
                        'from' => $fromDate,
                        'to' => $toDate
                    ]
                ];
                
                file_put_contents(
                    $routeFile,
                    json_encode($routeData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
                );
                
                echo "   └── {$routeName}\n";
                echo "       - Puntos/Paradas: " . count($waypoints) . "\n";
                
                // Mostrar los puntos
                foreach ($waypoints as $wp) {
                    $zoneName = $wp['zone']['name'];
                    $lat = $wp['zone']['centerPoint']['latitude'] ?? 'N/A';
                    $lon = $wp['zone']['centerPoint']['longitude'] ?? 'N/A';
                    
                    if (is_numeric($lat) && is_numeric($lon)) {
                        $lat = round($lat, 6);
                        $lon = round($lon, 6);
                    }
                    
                    echo "          #{$wp['sequence']}: {$zoneName} ({$lat}, {$lon})\n";
                }
            }
            
            echo "\n";
        }
        
        // 8. Routes sin dispositivo
        if (!empty($routesWithoutDevice)) {
            $noDeviceFolder = $config['output_dir'] . '/_sin_dispositivo';
            mkdir($noDeviceFolder, 0755, true);
            
            echo "📂 Routes sin dispositivo\n";
            
            foreach ($routesWithoutDevice as $index => $route) {
                $routeName = $route['name'] ?? "route_$index";
                $routeFileName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $routeName);
                
                // Procesar waypoints igual que arriba
                $waypoints = [];
                $routePlanItems = $route['routePlanItemCollection'] ?? [];
                
                foreach ($routePlanItems as $planItem) {
                    $zoneId = $planItem['zone']['id'] ?? null;
                    $zone = $zoneId ? ($zoneIndex[$zoneId] ?? null) : null;
                    
                    $centerPoint = null;
                    if ($zone && isset($zone['points']) && !empty($zone['points'])) {
                        $latSum = 0;
                        $lonSum = 0;
                        $count = count($zone['points']);
                        
                        foreach ($zone['points'] as $point) {
                            $latSum += $point['y'] ?? 0;
                            $lonSum += $point['x'] ?? 0;
                        }
                        
                        $centerPoint = [
                            'latitude' => $latSum / $count,
                            'longitude' => $lonSum / $count
                        ];
                    }
                    
                    $waypoints[] = [
                        'sequence' => $planItem['sequence'] ?? $index,
                        'zone' => [
                            'id' => $zoneId,
                            'name' => $zone['name'] ?? 'Desconocida',
                            'centerPoint' => $centerPoint,
                            'points' => $zone['points'] ?? []
                        ]
                    ];
                }
                
                usort($waypoints, fn($a, $b) => ($a['sequence'] ?? 0) <=> ($b['sequence'] ?? 0));
                
                $routeData = [
                    'route' => [
                        'id' => $route['id'],
                        'name' => $route['name'] ?? '',
                        'startTime' => $route['startTime'] ?? null,
                        'endTime' => $route['endTime'] ?? null
                    ],
                    'waypoints' => $waypoints,
                    'waypointCount' => count($waypoints)
                ];
                
                file_put_contents(
                    $noDeviceFolder . '/' . $routeFileName . '.json',
                    json_encode($routeData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
                );
                
                echo "   └── {$routeName} ({$routeData['waypointCount']} puntos)\n";
            }
            echo "\n";
        }
        
        // 9. Resumen
        $summary = [
            'exportDate' => date('Y-m-d H:i:s'),
            'dateRange' => ['from' => $fromDate, 'to' => $toDate],
            'totalRoutes' => count($routes),
            'totalZones' => count($zones),
            'devicesWithRoutes' => count($routesByDevice),
            'devicesSummary' => []
        ];
        
        foreach ($routesByDevice as $deviceId => $deviceRoutes) {
            $device = $deviceIndex[$deviceId] ?? null;
            $totalWaypoints = 0;
            foreach ($deviceRoutes as $r) {
                $totalWaypoints += count($r['routePlanItemCollection'] ?? []);
            }
            
            $summary['devicesSummary'][] = [
                'deviceId' => $deviceId,
                'deviceName' => $device['name'] ?? 'Desconocido',
                'routeCount' => count($deviceRoutes),
                'totalWaypoints' => $totalWaypoints
            ];
        }
        
        file_put_contents(
            $config['output_dir'] . '/resumen.json',
            json_encode($summary, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        );
        
        echo "===========================================\n";
        echo "✅ Exportación completada\n";
        echo "   Directorio: {$config['output_dir']}\n";
        echo "   Total routes: " . count($routes) . "\n";
        echo "   Total zones: " . count($zones) . "\n";
        echo "===========================================\n";
        
    } catch (Exception $e) {
        echo "❌ Error: " . $e->getMessage() . "\n";
        exit(1);
    }
}

main();