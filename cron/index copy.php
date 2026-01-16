<?php

/**
 * Script para recuperar todas las Routes de Geotab del día de hoy
 * y crear una carpeta por cada unidad (Device) con sus rutas en archivos JSON
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
            
            // CORRECCIÓN: Solo actualizar servidor si es un hostname válido
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
        
        // Verificar si hay error en la respuesta de Geotab
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
    echo "  GEOTAB - Exportar Routes por Unidad\n";
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
        
        // 2. Obtener todos los dispositivos (unidades)
        echo "🚛 Obteniendo dispositivos...\n";
        $devicesResponse = $api->call('Get', [
            'typeName' => 'Device'
        ]);
        
        $devices = $devicesResponse['result'] ?? [];
        echo "   Dispositivos encontrados: " . count($devices) . "\n\n";
        
        // Crear índice de dispositivos por ID
        $deviceIndex = [];
        foreach ($devices as $device) {
            $deviceIndex[$device['id']] = $device;
        }
        
        // 3. Obtener todas las Routes del día de hoy
        echo "📍 Obteniendo Routes del día de hoy...\n";
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
        
        // 4. Agrupar routes por dispositivo
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
        echo "   - Routes sin dispositivo asignado: " . count($routesWithoutDevice) . "\n\n";
        
        // 5. Crear directorio principal
        if (!is_dir($config['output_dir'])) {
            mkdir($config['output_dir'], 0755, true);
        }
        
        echo "📁 Creando estructura de carpetas en: {$config['output_dir']}\n\n";
        
        // 6. Crear carpeta por cada dispositivo y guardar sus routes
        foreach ($routesByDevice as $deviceId => $deviceRoutes) {
            $device = $deviceIndex[$deviceId] ?? null;
            $deviceName = $device['name'] ?? $deviceId;
            
            $folderName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $deviceName);
            $deviceFolder = $config['output_dir'] . '/' . $folderName;
            
            if (!is_dir($deviceFolder)) {
                mkdir($deviceFolder, 0755, true);
            }
            
            echo "📂 {$deviceName}\n";
            
            if ($device) {
                file_put_contents(
                    $deviceFolder . '/device_info.json',
                    json_encode($device, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
                );
            }
            
            foreach ($deviceRoutes as $index => $route) {
                $routeName = $route['name'] ?? "route_$index";
                $routeFileName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $routeName);
                $routeFile = $deviceFolder . '/' . $routeFileName . '.json';
                
                $routeData = [
                    'route' => $route,
                    'device' => $device,
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
                echo "       - ID: {$route['id']}\n";
                echo "       - Inicio: " . ($route['startTime'] ?? 'N/A') . "\n";
                echo "       - Fin: " . ($route['endTime'] ?? 'N/A') . "\n";
            }
            
            echo "\n";
        }
        
        // 7. Guardar routes sin dispositivo
        if (!empty($routesWithoutDevice)) {
            $noDeviceFolder = $config['output_dir'] . '/_sin_dispositivo';
            mkdir($noDeviceFolder, 0755, true);
            
            echo "📂 Routes sin dispositivo asignado\n";
            
            foreach ($routesWithoutDevice as $index => $route) {
                $routeName = $route['name'] ?? "route_$index";
                $routeFileName = preg_replace('/[^a-zA-Z0-9_\-]/', '_', $routeName);
                $routeFile = $noDeviceFolder . '/' . $routeFileName . '.json';
                
                file_put_contents(
                    $routeFile,
                    json_encode($route, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
                );
                
                echo "   └── {$routeName}\n";
            }
            echo "\n";
        }
        
        // 8. Crear archivo resumen
        $summary = [
            'exportDate' => date('Y-m-d H:i:s'),
            'dateRange' => ['from' => $fromDate, 'to' => $toDate],
            'totalRoutes' => count($routes),
            'devicesWithRoutes' => count($routesByDevice),
            'routesWithoutDevice' => count($routesWithoutDevice),
            'devicesSummary' => []
        ];
        
        foreach ($routesByDevice as $deviceId => $deviceRoutes) {
            $device = $deviceIndex[$deviceId] ?? null;
            $summary['devicesSummary'][] = [
                'deviceId' => $deviceId,
                'deviceName' => $device['name'] ?? 'Desconocido',
                'routeCount' => count($deviceRoutes)
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
        echo "===========================================\n";
        
    } catch (Exception $e) {
        echo "❌ Error: " . $e->getMessage() . "\n";
        exit(1);
    }
}

main();