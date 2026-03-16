#!/bin/bash
set -e

# Benchmark script for claude-run
# Tests performance with different file sizes: 50MB, 200MB, 500MB

BENCH_DIR="${BENCH_DIR:-/tmp/claude-run-bench}"
SIZES=(50 200 500)  # MB

echo "=== Claude Run Benchmark Suite ==="
echo "Benchmark directory: $BENCH_DIR"
echo ""

# Create benchmark directory
mkdir -p "$BENCH_DIR"

# Generate test JSONL files at different sizes
generate_test_file() {
    local size_mb=$1
    local output_file="$BENCH_DIR/test_${size_mb}mb.jsonl"
    local target_bytes=$((size_mb * 1024 * 1024))

    echo "Generating test file: $output_file (target: ${size_mb}MB)"

    # Generate content efficiently using dd
    # Each line is ~200 bytes, so calculate number of lines needed
    local bytes_per_line=200
    local num_lines=$((target_bytes / bytes_per_line + 1))

    {
        for i in $(seq 1 $num_lines); do
            printf '{"type":"user","role":"user","content":"Message %d: Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."}\n' "$i"
        done
    } > "$output_file"

    echo "✓ Generated: $(stat -f%z "$output_file" 2>/dev/null || stat -c%s "$output_file" 2>/dev/null) bytes"
}

# Run benchmark on a test file
run_benchmark() {
    local size_mb=$1
    local test_file="$BENCH_DIR/test_${size_mb}mb.jsonl"

    echo ""
    echo "Benchmarking: ${size_mb}MB file"
    echo "File: $test_file"

    # Build release binary
    echo "Building release binary..."
    cargo build --release 2>&1 | grep -v "Compiling\|Finished" || true

    # Clear and recreate projects directory for isolated measurement
    rm -rf "$BENCH_DIR/projects"

    # Create temporary project directory (must be at claude_dir/projects/*)
    # Use unique session filenames to avoid ID collisions across sizes
    local project_dir="$BENCH_DIR/projects/project_${size_mb}mb"
    mkdir -p "$project_dir"
    cp "$test_file" "$project_dir/session_${size_mb}.jsonl"

    # Start server and measure time
    echo "Starting server and warming up..."
    local start_time=$(date +%s%N)

    timeout 10 ./target/release/claude-run --port 12001 --dir "$BENCH_DIR" > /dev/null 2>&1 &
    local server_pid=$!

    sleep 2  # Let server start

    # Make test request
    echo "Making test request..."
    local request_start=$(date +%s%N)
    curl -s http://localhost:12001/api/sessions > /dev/null
    local request_end=$(date +%s%N)

    kill $server_pid 2>/dev/null || true
    wait $server_pid 2>/dev/null || true

    local request_duration=$(( (request_end - request_start) / 1000000 ))
    echo "Request time: ${request_duration}ms"
}

# Main execution
for size in "${SIZES[@]}"; do
    generate_test_file $size
done

echo ""
echo "=== Running Benchmarks ==="
for size in "${SIZES[@]}"; do
    run_benchmark $size
done

echo ""
echo "✓ Benchmark suite completed"
