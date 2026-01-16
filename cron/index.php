<?php

/**
 * Script para recuperar Routes de Geotab y exportar en formato polygon/stations
 * con coordenadas UTM
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
 * Convierte coordenadas WGS84 (lat/lon) a UTM
 * 
 * @param float $lat Latitud en grados decimales
 * @param float $lon Longitud en grados decimales
 * @param int|null $forceZone Forzar zona UTM (opcional)
 * @return array ['x' => easting, 'y' => northing, 'zone' => zona]
 */
function latLonToUTM(float $lat, float $lon, ?int $forceZone = null): array {
    // Constantes WGS84
    $a = 6378137.0;           // Radio ecuatorial
    $f = 1 / 298.257223563;   // Aplanamiento
    $k0 = 0.9996;             // Factor de escala
    
    $e2 = 2 * $f - $f * $f;   // Excentricidad al cuadrado
    $e4 = $e2 * $e2;
    $e6 = $e4 * $e2;
    $ep2 = $e2 / (1 - $e2);   // Segunda excentricidad al cuadrado
    
    // Calcular zona UTM
    if ($forceZone !== null) {
        $zone = $forceZone;
    } else {
        $zone = (int) floor(($lon + 180) / 6) + 1;
        
        // Ajustes especiales para Noruega y Svalbard
        if ($lat >= 56 && $lat < 64 && $lon >= 3 && $lon < 12) {
            $zone = 32;
        }
    }
    
    // Meridiano central de la zona
    $lon0 = ($zone - 1) * 6 - 180 + 3;
    
    // Convertir a radianes
    $latRad = deg2rad($lat);
    $lonRad = deg2rad($lon);
    $lon0Rad = deg2rad($lon0);
    
    $N = $a / sqrt(1 - $e2 * sin($latRad) * sin($latRad));
    $T = tan($latRad) * tan($latRad);
    $C = $ep2 * cos($latRad) * cos($latRad);
    $A = cos($latRad) * ($lonRad - $lon0Rad);
    
    $M = $a * (
        (1 - $e2/4 - 3*$e4/64 - 5*$e6/256) * $latRad
        - (3*$e2/8 + 3*$e4/32 + 45*$e6/1024) * sin(2*$latRad)
        + (15*$e4/256 + 45*$e6/1024) * sin(4*$latRad)
        - (35*$e6/3072) * sin(6*$latRad)
    );
    
    $x = $k0 * $N * (
        $A 
        + (1 - $T + $C) * pow($A, 3) / 6
        + (5 - 18*$T + $T*$T + 72*$C - 58*$ep2) * pow($A, 5) / 120
    ) + 500000; // False easting
    
    $y = $k0 * (
        $M + $N * tan($latRad) * (
            $A*$A/2
            + (5 - $T + 9*$C + 4*$C*$C) * pow($A, 4) / 24
            + (61 - 58*$T + $T*$T + 600*$C - 330*$ep2) * pow($A, 6) / 720
        )
    );
    
    // Ajuste para hemisferio sur
    if ($lat < 0) {
        $y += 10000000; // False northing
    }
    
    return [
        'x' => (int) round($x),
        'y' => (int) round($y),
        'zone' => $zone
    ];
}

/**
 * Genera el JSON en formato polygon/stations
 */
function generateRoutePolygonJSON(array $waypoints, ?int $utmZone = null): array {
    $points = [];
    $stations = [];
    $detectedZone = null;
    
    foreach ($waypoints as $index => $waypoint) {
        $centerPoint = $waypoint['zone']['centerPoint'] ?? null;
        
        if ($centerPoint && isset($centerPoint['latitude']) && isset($centerPoint['longitude'])) {
            $utm = latLonToUTM(
                $centerPoint['latitude'],
                $centerPoint['longitude'],
                $utmZone ?? $detectedZone
            );
            
            // Guardar la zona del primer punto para mantener consistencia
            if ($detectedZone === null) {
                $detectedZone = $utm['zone'];
            }
            
            $points[] = [
                'x' => $utm['x'],
                'y' => $utm['y']
            ];
            
            // Determinar tipo de waypoint
            $waypointType = 'VIA';
            if ($index === 0) {
                $waypointType = 'START';
            } elseif ($index === count($waypoints) - 1) {
                $waypointType = 'DEST';
            }
            
            $stations[] = [
                'polyIdx' => $index,
                'wayPointType' => $waypointType
            ];
        }
    }
    
    return [
        'polygon' => [
            'lineString' => [
                'points' => $points
            ]
        ],
        'stations' => $stations,
        '_metadata' => [
            'utmZone' => $detectedZone,
            'pointCount' => count($points),
            'coordinateSystem' => 'UTM WGS84'
        ]
    ];
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
        'output_dir' => './geotab_routes_' . date('Y-m-d'),
        'utm_zone' => 30  // Zona UTM para España (30 o 31). null = auto-detectar
    ];
    
    // Fechas de hoy (UTC)
    $fromDate = (new DateTime('today', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    $toDate = (new DateTime('tomorrow', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    
    echo "===========================================\n";
    echo "  GEOTAB - Exportar Routes (Polygon/UTM)\n";
    echo "===========================================\n";
    echo "Fecha desde: $fromDate\n";
    echo "Fecha hasta: $toDate\n";
    echo "Zona UTM: " . ($config['utm_zone'] ?? 'Auto') . "\n\n";
    
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
        
        // 2. Obtener dispositivos
        echo "🚛 Obteniendo dispositivos...\n";
        $devicesResponse = $api->call('Get', ['typeName' => 'Device']);
        $devices = $devicesResponse['result'] ?? [];
        echo "   Dispositivos: " . count($devices) . "\n\n";
        
        $deviceIndex = [];
        foreach ($devices as $device) {
            $deviceIndex[$device['id']] = $device;
        }
        
        // 3. Obtener Zones
        echo "📍 Obteniendo Zones...\n";
        $zonesResponse = $api->call('Get', ['typeName' => 'Zone']);
        $zones = $zonesResponse['result'] ?? [];
        echo "   Zones: " . count($zones) . "\n\n";
        
        $zoneIndex = [];
        foreach ($zones as $zone) {
            $zoneIndex[$zone['id']] = $zone;
        }
        
        // 4. Obtener Routes
        echo "🗺️  Obteniendo Routes...\n";
        $routesResponse = $api->call('Get', [
            'typeName' => 'Route',
            'search' => [
                'fromDate' => $fromDate,
                'toDate' => $toDate
            ]
        ]);
        
        $routes = $routesResponse['result'] ?? [];
        echo "   Routes: " . count($routes) . "\n\n";
        
        if (empty($routes)) {
            echo "⚠️  No se encontraron routes para hoy.\n";
            return;
        }
        
        // 5. Agrupar por dispositivo
        $routesByDevice = [];
        $routesWithoutDevice = [];
        
        foreach ($routes as $route) {
            $deviceId = $route['device']['id'] ?? null;
            
            if ($deviceId && $deviceId !== 'NoDeviceId') {
                $routesByDevice[$deviceId][] = $route;
            } else {
                $routesWithoutDevice[] = $route;
            }
        }
        
        // 6. Crear directorio
        if (!is_dir($config['output_dir'])) {
            mkdir($config['output_dir'], 0755, true);
        }
        
        echo "📁 Exportando a: {$config['output_dir']}\n\n";
        
        // 7. Procesar cada dispositivo
        foreach ($routesByDevice as $deviceId => $deviceRoutes) {
            $device = $deviceIndex[$deviceId] ?? null;
            $deviceName = $device['name'] ?? $deviceId;
            
            $folderName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $deviceName);
            $deviceFolder = $config['output_dir'] . '/' . $folderName;
            
            if (!is_dir($deviceFolder)) {
                mkdir($deviceFolder, 0755, true);
            }
            
            echo "📂 {$deviceName}\n";
            
            foreach ($deviceRoutes as $index => $route) {
                $routeName = $route['name'] ?? "route_$index";
                $routeFileName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $routeName);
                
                // Extraer waypoints
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
                        'sequence' => $planItem['sequence'] ?? count($waypoints),
                        'zone' => [
                            'id' => $zoneId,
                            'name' => $zone['name'] ?? 'Desconocida',
                            'centerPoint' => $centerPoint
                        ]
                    ];
                }
                
                // Ordenar por secuencia
                usort($waypoints, fn($a, $b) => ($a['sequence'] ?? 0) <=> ($b['sequence'] ?? 0));
                
                // Generar JSON en formato polygon/stations
                $polygonData = generateRoutePolygonJSON($waypoints, $config['utm_zone']);
                
                // Guardar JSON polygon
                $polygonFile = $deviceFolder . '/' . $routeFileName . '_polygon.json';
                file_put_contents(
                    $polygonFile,
                    json_encode($polygonData, JSON_PRETTY_PRINT)
                );
                
                // También guardar JSON completo con info adicional
                $fullData = [
                    'routeInfo' => [
                        'id' => $route['id'],
                        'name' => $routeName,
                        'startTime' => $route['startTime'] ?? null,
                        'endTime' => $route['endTime'] ?? null,
                        'device' => $deviceName
                    ],
                    'polygon' => $polygonData['polygon'],
                    'stations' => $polygonData['stations'],
                    'waypointDetails' => array_map(function($wp, $idx) {
                        return [
                            'polyIdx' => $idx,
                            'zoneName' => $wp['zone']['name'],
                            'latLon' => $wp['zone']['centerPoint']
                        ];
                    }, $waypoints, array_keys($waypoints)),
                    '_metadata' => $polygonData['_metadata']
                ];
                
                $fullFile = $deviceFolder . '/' . $routeFileName . '_full.json';
                file_put_contents(
                    $fullFile,
                    json_encode($fullData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
                );
                
                echo "   └── {$routeName}\n";
                echo "       - Puntos: " . count($polygonData['stations']) . "\n";
                echo "       - Zona UTM: " . ($polygonData['_metadata']['utmZone'] ?? 'N/A') . "\n";
                echo "       - Archivos: {$routeFileName}_polygon.json, {$routeFileName}_full.json\n";
                
                // Mostrar puntos
                foreach ($polygonData['polygon']['lineString']['points'] as $idx => $point) {
                    $station = $polygonData['stations'][$idx] ?? [];
                    $wpName = $waypoints[$idx]['zone']['name'] ?? 'Punto';
                    $type = $station['wayPointType'] ?? 'VIA';
                    echo "          [{$type}] #{$idx}: {$wpName} (x:{$point['x']}, y:{$point['y']})\n";
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
                
                $waypoints = [];
                foreach ($route['routePlanItemCollection'] ?? [] as $planItem) {
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
                        'sequence' => $planItem['sequence'] ?? count($waypoints),
                        'zone' => [
                            'name' => $zone['name'] ?? 'Desconocida',
                            'centerPoint' => $centerPoint
                        ]
                    ];
                }
                
                usort($waypoints, fn($a, $b) => ($a['sequence'] ?? 0) <=> ($b['sequence'] ?? 0));
                
                $polygonData = generateRoutePolygonJSON($waypoints, $config['utm_zone']);
                
                file_put_contents(
                    $noDeviceFolder . '/' . $routeFileName . '_polygon.json',
                    json_encode($polygonData, JSON_PRETTY_PRINT)
                );
                
                echo "   └── {$routeName} ({$polygonData['_metadata']['pointCount']} puntos)\n";
            }
            echo "\n";
        }
        
        echo "===========================================\n";
        echo "✅ Exportación completada\n";
        echo "   Total routes: " . count($routes) . "\n";
        echo "===========================================\n";
        
    } catch (Exception $e) {
        echo "❌ Error: " . $e->getMessage() . "\n";
        exit(1);
    }
}

main();