<?php

$dir = 'models/';

// Ensure models directory exists
if (!is_dir($dir)) {
    if (!mkdir($dir, 0777, true) && !is_dir($dir)) {
        http_response_code(500);
        echo "Failed to create models directory";
        exit;
    }
}

// Ensure models directory is writable
if (!is_writable($dir)) {
    chmod($dir, 0777);
    if (!is_writable($dir)) {
        http_response_code(500);
        echo "Models directory is not writable";
        exit;
    }
}

// Handle GET request (loading)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['id'])) {
        $id = $_GET['id'];
        
        // Validate ID (8-char alphanumeric)
        if (!preg_match('/^[a-zA-Z0-9]{8}$/', $id)) {
            http_response_code(400);
            echo "Invalid ID format";
            exit;
        }

        $filename = $dir . $id . '.json';
        if (file_exists($filename)) {
            // Update timestamp
            touch($filename);
            
            header('Content-Type: text/plain');
            echo file_get_contents($filename);
            exit;
        } else {
            http_response_code(404);
            echo "Model not found";
            exit;
        }
    }
}

// Handle POST request (saving)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = file_get_contents('php://input');
    
    if (empty($data)) {
        http_response_code(400);
        echo "No data provided";
        exit;
    }

    // Check if an ID was provided for updating
    if (isset($_GET['id'])) {
        $id = $_GET['id'];
        // Validate ID (8-char alphanumeric)
        if (!preg_match('/^[a-zA-Z0-9]{8}$/', $id)) {
            http_response_code(400);
            echo "Invalid ID format";
            exit;
        }
    } else {
        // Generate unique 8-char alphanumeric ID
        $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        do {
            $id = '';
            for ($i = 0; $i < 8; $i++) {
                $id .= $chars[rand(0, strlen($chars) - 1)];
            }
        } while (file_exists($dir . $id . '.json'));
    }

    // Save model data
    file_put_contents($dir . $id . '.json', $data);

    // Lazy cleanup (older than 365 days)
    $files = glob($dir . '*.json');
    $now = time();
    $dayInSeconds = 24 * 60 * 60;
    foreach ($files as $file) {
        if (is_file($file)) {
            if ($now - filemtime($file) >= 365 * $dayInSeconds) {
                unlink($file);
            }
        }
    }

    echo $id;
    exit;
}

http_response_code(405);
echo "Method not allowed";
