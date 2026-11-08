<?php
/** Read cgroup and per-process memory without recording command lines or env. */

function readText(string $path): ?string {
    if (!is_readable($path)) {
        return null;
    }
    $value = @file_get_contents($path);
    return false === $value ? null : trim($value);
}

function readNumber(string $path): int|float|null {
    $value = readText($path);
    return null !== $value && is_numeric($value) ? $value + 0 : null;
}

function readMap(string $path): ?array {
    $value = readText($path);
    if (null === $value) {
        return null;
    }
    $result = [];
    foreach (preg_split('/\r?\n/', $value) as $line) {
        $parts = preg_split('/\s+/', trim($line));
        // cgroup rows have two columns; proc status/smaps rows append "kB".
        if (count($parts) >= 2 && is_numeric($parts[1])) {
            $result[$parts[0]] = $parts[1] + 0;
        }
    }
    return $result;
}

function processRole(int $pid, string $comm): string {
    $cmdline = (string) @file_get_contents("/proc/{$pid}/cmdline");
    if (str_contains($cmdline, 'php-fpm: master')) {
        return 'fpm_master';
    }
    if (str_contains($cmdline, 'php-fpm: pool') || str_contains($comm, 'php-fpm')) {
        return 'fpm_worker';
    }
    if (str_contains($comm, 'nginx')) {
        return 'nginx';
    }
    if (str_contains($comm, 'supervisord')) {
        return 'supervisord';
    }
    return 'other';
}

function processMetrics(): array {
    $processes = [];
    $unavailable = 0;
    foreach (glob('/proc/[0-9]*') ?: [] as $directory) {
        $pid = (int) basename($directory);
        $rollup = readMap($directory . '/smaps_rollup');
        if (null === $rollup) {
            ++$unavailable;
            continue;
        }
        $status = readMap($directory . '/status');
        $comm = readText($directory . '/comm') ?: 'unknown';
        $item = [
            'pid' => $pid,
            'ppid' => isset($status['PPid:']) ? (int) $status['PPid:'] : null,
            'comm' => $comm,
            'role' => processRole($pid, $comm),
            'rss_bytes' => isset($rollup['Rss:']) ? ((int) $rollup['Rss:'] * 1024) : null,
            'pss_bytes' => isset($rollup['Pss:']) ? ((int) $rollup['Pss:'] * 1024) : null,
            'private_bytes' => isset($rollup['Private_Clean:'], $rollup['Private_Dirty:'])
                ? (((int) $rollup['Private_Clean:'] + (int) $rollup['Private_Dirty:']) * 1024) : null,
            'shared_bytes' => isset($rollup['Shared_Clean:'], $rollup['Shared_Dirty:'])
                ? (((int) $rollup['Shared_Clean:'] + (int) $rollup['Shared_Dirty:']) * 1024) : null,
            'anonymous_bytes' => isset($rollup['Anonymous:']) ? ((int) $rollup['Anonymous:'] * 1024) : null,
            'swap_bytes' => isset($rollup['Swap:']) ? ((int) $rollup['Swap:'] * 1024) : null,
            'fd_count' => is_dir($directory . '/fd') ? count(glob($directory . '/fd/*') ?: []) : null
        ];
        $processes[] = $item;
    }
    usort($processes, fn($a, $b) => $a['pid'] <=> $b['pid']);
    $roles = [];
    foreach ($processes as $process) {
        $role = $process['role'];
        if (!isset($roles[$role])) {
            $roles[$role] = ['processes' => 0, 'rss_bytes' => 0, 'pss_bytes' => 0, 'private_bytes' => 0, 'fd_count' => 0];
        }
        ++$roles[$role]['processes'];
        foreach (['rss_bytes', 'pss_bytes', 'private_bytes', 'fd_count'] as $field) {
            $roles[$role][$field] += $process[$field] ?? 0;
        }
    }
    return ['processes' => $processes, 'roles' => $roles, 'smaps_unavailable_processes' => $unavailable];
}

function cgroupMetrics(): array {
    $root = '/sys/fs/cgroup';
    if (is_file($root . '/cgroup.controllers')) {
        $cpuStat = readMap($root . '/cpu.stat');
        $events = readMap($root . '/memory.events');
        return [
            'version' => 2,
            'memory_current_bytes' => readNumber($root . '/memory.current'),
            'memory_peak_bytes' => readNumber($root . '/memory.peak'),
            'memory_max_bytes' => readNumber($root . '/memory.max'),
            'memory_events' => $events,
            'oom_events' => $events['oom'] ?? null,
            'oom_kill_events' => $events['oom_kill'] ?? null,
            'cpu_stat' => $cpuStat,
            'cpu_usage_usec' => $cpuStat['usage_usec'] ?? null,
            'cpu_nr_throttled' => $cpuStat['nr_throttled'] ?? null,
            'cpu_throttled_usec' => $cpuStat['throttled_usec'] ?? null,
            'cpu_max' => readText($root . '/cpu.max'),
            'pids_current' => readNumber($root . '/pids.current'),
            'pids_max' => readNumber($root . '/pids.max')
        ];
    }
    $cpuStat = readMap($root . '/cpu/cpu.stat') ?: readMap($root . '/cpuacct/cpu.stat');
    $usageNs = readNumber($root . '/cpuacct/cpuacct.usage');
    $oom = readMap($root . '/memory/memory.oom_control');
    return [
        'version' => 1,
        'memory_current_bytes' => readNumber($root . '/memory/memory.usage_in_bytes'),
        'memory_peak_bytes' => readNumber($root . '/memory/memory.max_usage_in_bytes'),
        'memory_max_bytes' => readNumber($root . '/memory/memory.limit_in_bytes'),
        'memory_events' => null,
        'oom_events' => $oom['oom_kill'] ?? null,
        'oom_kill_events' => $oom['oom_kill'] ?? null,
        'cpu_stat' => $cpuStat,
        'cpu_usage_usec' => null === $usageNs ? null : $usageNs / 1000,
        'cpu_nr_throttled' => $cpuStat['nr_throttled'] ?? null,
        'cpu_throttled_usec' => isset($cpuStat['throttled_time']) ? $cpuStat['throttled_time'] / 1000 : null,
        'cpu_max' => null,
        'pids_current' => readNumber($root . '/pids/pids.current'),
        'pids_max' => readNumber($root . '/pids/pids.max')
    ];
}

$memory = cgroupMetrics();
$process = processMetrics();
echo json_encode([
    'available' => true,
    'collected_at_unix' => microtime(true),
    'cgroup' => $memory,
    'process' => $process,
    'memory_current_bytes' => $memory['memory_current_bytes'],
    'memory_peak_bytes' => $memory['memory_peak_bytes'],
    'oom_kill_events' => $memory['oom_kill_events']
], JSON_UNESCAPED_SLASHES), "\n";
