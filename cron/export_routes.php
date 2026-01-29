<?php

// ============================================
// ANTI-CACHÉ: Redirección automática con timestamp
// ============================================
/* if (!isset($_GET['_nc'])) {
    header('Location: ' . $_SERVER['PHP_SELF'] . '?_nc=' . time());
    exit();
}*/

// ============================================
// DESACTIVAR CACHÉ HTTP
// ============================================
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

// ============================================
// CORS HEADERS
// ============================================
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, t');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

header('Content-Type: application/json; charset=utf-8');

// Limpiar caché de archivos
clearstatcache(true);

// ============================================
// CLASES Y FUNCIONES
// ============================================

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
 * Genera el JSON de la ruta con coordenadas WGS84 × 100,000
 */
function generateRoutePolygonJSON(array $waypoints): array {
    $points = [];
    $stations = [];
    
    foreach ($waypoints as $index => $waypoint) {
        $centerPoint = $waypoint['zone']['centerPoint'] ?? null;
        
        if ($centerPoint && isset($centerPoint['latitude']) && isset($centerPoint['longitude'])) {
            // WGS84 multiplicado por 100,000
            $points[] = [
                'x' => (int) round($centerPoint['longitude'] * 100000),
                'y' => (int) round($centerPoint['latitude'] * 100000)
            ];
            
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
            'pointCount' => count($points),
            'coordinateSystem' => 'WGS84 x 100000'
        ]
    ];
}

// ============================================
// FUNCIÓN PRINCIPAL
// ============================================

function main(): array {
    clearstatcache(true);
    
    $result = [
        'success' => false,
        'message' => '',
        'timestamp' => date('Y-m-d H:i:s'),
        'data' => [
            'routes_count' => 0,
            'devices_count' => 0,
            'exported_files' => []
        ],
        'log' => []
    ];
    
    $config = [
        'database' => 'emaya',
        'username' => 'dsancho@digittecnic.com',
        'password' => 'Catalunya4**',
        'server'   => 'my.geotab.com',
        'output_dir' => __DIR__ . '/routes'
    ];
    
    $fromDate = (new DateTime('today', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    $toDate = (new DateTime('tomorrow', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z');
    
    $result['log'][] = "Inicio: " . $result['timestamp'];
    $result['log'][] = "Fecha desde: $fromDate";
    $result['log'][] = "Fecha hasta: $toDate";
    $result['log'][] = "Directorio: " . $config['output_dir'];
    
    try {
        // Crear directorio principal
        clearstatcache(true, $config['output_dir']);
        if (!is_dir($config['output_dir'])) {
            if (!@mkdir($config['output_dir'], 0777, true)) {
                throw new Exception('No se pudo crear directorio: ' . $config['output_dir']);
            }
            @chmod($config['output_dir'], 0777);
            $result['log'][] = "Directorio creado";
        }
        
        clearstatcache(true, $config['output_dir']);
        if (!is_writable($config['output_dir'])) {
            throw new Exception('Directorio no escribible: ' . $config['output_dir']);
        }
        
        $result['log'][] = "Directorio OK";
        
        // Autenticar
        $api = new GeotabAPI(
            $config['database'],
            $config['username'],
            $config['password'],
            $config['server']
        );
        
        $result['log'][] = "Autenticando...";
        $api->authenticate();
        $result['log'][] = "Autenticación OK";
        
        // Obtener dispositivos
        $devicesResponse = $api->call('Get', ['typeName' => 'Device']);
        $devices = $devicesResponse['result'] ?? [];
        $result['data']['devices_count'] = count($devices);
        $result['log'][] = "Dispositivos: " . count($devices);
        
        $deviceIndex = [];
        foreach ($devices as $device) {
            $deviceIndex[$device['id']] = $device;
        }
        
        // Obtener Zones
        $zonesResponse = $api->call('Get', ['typeName' => 'Zone']);
        $zones = $zonesResponse['result'] ?? [];
        $result['log'][] = "Zones: " . count($zones);
        
        $zoneIndex = [];
        foreach ($zones as $zone) {
            $zoneIndex[$zone['id']] = $zone;
        }
        
        // Obtener Routes
        $routesResponse = $api->call('Get', [
            'typeName' => 'Route',
            'search' => [
                'fromDate' => $fromDate,
                'toDate' => $toDate
            ]
        ]);
        
        $routes = $routesResponse['result'] ?? [];
        $result['data']['routes_count'] = count($routes);
        $result['log'][] = "Routes: " . count($routes);
        
        if (empty($routes)) {
            $result['success'] = true;
            $result['message'] = 'No hay routes para hoy';
            return $result;
        }
        
        // Agrupar por dispositivo
        $routesByDevice = [];
        foreach ($routes as $route) {
            $deviceId = $route['device']['id'] ?? null;
            if ($deviceId && $deviceId !== 'NoDeviceId') {
                $routesByDevice[$deviceId][] = $route;
            }
        }
        
        // Procesar cada dispositivo
        foreach ($routesByDevice as $deviceId => $deviceRoutes) {
            $device = $deviceIndex[$deviceId] ?? null;
            $deviceName = $device['name'] ?? $deviceId;
            $deviceFolder = $config['output_dir'] . '/' . $deviceId;
            
            // Crear carpeta del dispositivo
            clearstatcache(true, $deviceFolder);
            if (!is_dir($deviceFolder)) {
                @mkdir($deviceFolder, 0777, true);
                @chmod($deviceFolder, 0777);
            }
            
            $result['log'][] = "Procesando: $deviceId ($deviceName)";
            
            foreach ($deviceRoutes as $route) {
                $routeId = $route['id'] ?? 'unknown';
                $routeName = $route['name'] ?? $routeId;
                
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
                            'id' => $zoneId,
                            'name' => $zone['name'] ?? 'Desconocida',
                            'centerPoint' => $centerPoint
                        ]
                    ];
                }
                
                usort($waypoints, fn($a, $b) => ($a['sequence'] ?? 0) <=> ($b['sequence'] ?? 0));
                
                $polygonData = generateRoutePolygonJSON($waypoints);
                $polygonFile = $deviceFolder . '/' . $routeId . '.json';
                $jsonContent = json_encode($polygonData, JSON_PRETTY_PRINT);
                
                $writeResult = @file_put_contents($polygonFile, $jsonContent, LOCK_EX);
                
                if ($writeResult !== false) {
                    @chmod($polygonFile, 0666);
                    
                    $result['data']['exported_files'][] = [
                        'device_id' => $deviceId,
                        'device_name' => $deviceName,
                        'route_id' => $routeId,
                        'route_name' => $routeName,
                        'file' => $polygonFile,
                        'points' => count($polygonData['stations']),
                        'bytes' => $writeResult
                    ];
                    
                    $result['log'][] = "  Exportado: {$routeId}.json - $writeResult bytes";
                } else {
                    $result['log'][] = "  ERROR: {$routeId}.json";
                }
            }
        }
        
        $result['success'] = true;
        $result['message'] = 'Exportación completada';
        $result['log'][] = "Completado: " . count($result['data']['exported_files']) . " archivos";
        
    } catch (Exception $e) {
        $result['success'] = false;
        $result['message'] = 'Error: ' . $e->getMessage();
        $result['log'][] = "ERROR: " . $e->getMessage();
    }
    
    return $result;
}

// ============================================
// EJECUTAR
// ============================================
$response = main();
echo json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);