#!/bin/bash
# Build and deployment script for IoT Ticker Platform

set -e

echo "========================================"
echo "IoT Ticker Platform - Build Script"
echo "========================================"

# Configuration
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_DIR/frontend"
BACKEND_DIR="$PROJECT_DIR/backend"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi
    log_info "Node.js version: $(node --version)"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed."
        exit 1
    fi
    log_info "npm version: $(npm --version)"
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 is not installed."
        exit 1
    fi
    log_info "Python version: $(python3 --version)"
    
    # Check pip
    if ! command -v pip3 &> /dev/null; then
        log_error "pip3 is not installed."
        exit 1
    fi
    
    log_info "All prerequisites met!"
}

# Install backend dependencies
install_backend() {
    log_info "Installing backend dependencies..."
    cd "$BACKEND_DIR"
    
    # Create virtual environment if not exists
    if [ ! -d "venv" ]; then
        python3 -m venv venv
        log_info "Created virtual environment"
    fi
    
    # Activate virtual environment
    source venv/bin/activate
    
    # Upgrade pip
    pip install --upgrade pip
    
    # Install dependencies
    pip install -r requirements.txt
    
    log_info "Backend dependencies installed!"
    cd "$PROJECT_DIR"
}

# Install frontend dependencies
install_frontend() {
    log_info "Installing frontend dependencies..."
    cd "$FRONTEND_DIR"
    
    npm install
    
    log_info "Frontend dependencies installed!"
    cd "$PROJECT_DIR"
}

# Build frontend
build_frontend() {
    log_info "Building frontend..."
    cd "$FRONTEND_DIR"
    
    npm run build
    
    log_info "Frontend build complete!"
    cd "$PROJECT_DIR"
}

# Initialize database
init_database() {
    log_info "Initializing database..."
    cd "$BACKEND_DIR"
    
    source venv/bin/activate
    python scripts/init_db.py
    
    log_info "Database initialized!"
    cd "$PROJECT_DIR"
}

# Run development servers
run_dev() {
    log_info "Starting development servers..."
    
    # Start backend in background
    cd "$BACKEND_DIR"
    source venv/bin/activate
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
    BACKEND_PID=$!
    log_info "Backend started (PID: $BACKEND_PID)"
    
    # Start frontend
    cd "$FRONTEND_DIR"
    npm run dev &
    FRONTEND_PID=$!
    log_info "Frontend started (PID: $FRONTEND_PID)"
    
    # Wait for both processes
    wait $BACKEND_PID $FRONTEND_PID
}

# Run production build
run_prod() {
    log_info "Starting production server..."
    cd "$BACKEND_DIR"
    
    source venv/bin/activate
    
    # Copy frontend dist to static folder
    if [ -d "$FRONTEND_DIR/dist" ]; then
        mkdir -p app/static
        cp -r "$FRONTEND_DIR/dist"/* app/static/
        log_info "Frontend assets copied to backend static folder"
    fi
    
    # Start uvicorn
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
}

# Clean build artifacts
clean() {
    log_info "Cleaning build artifacts..."
    
    # Clean frontend
    rm -rf "$FRONTEND_DIR/node_modules"
    rm -rf "$FRONTEND_DIR/dist"
    rm -rf "$FRONTEND_DIR/.vite"
    
    # Clean backend
    rm -rf "$BACKEND_DIR/venv"
    rm -rf "$BACKEND_DIR/__pycache__"
    find "$BACKEND_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    find "$BACKEND_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
    
    log_info "Clean complete!"
}

# Deploy to Databricks Apps
deploy() {
    log_info "Deploying to Databricks Apps..."
    
    # Build frontend first
    build_frontend
    
    # Check if databricks CLI is installed
    if ! command -v databricks &> /dev/null; then
        log_error "Databricks CLI is not installed. Please install it first."
        log_info "Run: pip install databricks-cli"
        exit 1
    fi
    
    # Deploy using Databricks Apps
    databricks apps deploy --app-config app.yaml
    
    log_info "Deployment complete!"
}

# Print usage
usage() {
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  check       Check prerequisites"
    echo "  install     Install all dependencies"
    echo "  build       Build frontend for production"
    echo "  init-db     Initialize database with seed data"
    echo "  dev         Start development servers"
    echo "  prod        Start production server"
    echo "  deploy      Deploy to Databricks Apps"
    echo "  clean       Clean build artifacts"
    echo "  all         Install, build, and init-db"
    echo ""
}

# Main
case "$1" in
    check)
        check_prerequisites
        ;;
    install)
        check_prerequisites
        install_backend
        install_frontend
        ;;
    build)
        build_frontend
        ;;
    init-db)
        init_database
        ;;
    dev)
        run_dev
        ;;
    prod)
        run_prod
        ;;
    deploy)
        deploy
        ;;
    clean)
        clean
        ;;
    all)
        check_prerequisites
        install_backend
        install_frontend
        build_frontend
        init_database
        log_info "All done! Run './build.sh dev' to start development servers."
        ;;
    *)
        usage
        exit 1
        ;;
esac
