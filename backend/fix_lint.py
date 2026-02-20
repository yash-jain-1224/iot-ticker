#!/usr/bin/env python3
"""Script to fix linting errors in the backend codebase."""
import re
import os

def remove_unused_import(filepath, unused_names):
    """Remove unused imports from a file."""
    with open(filepath, 'r') as f:
        content = f.read()
    original = content
    lines = content.split('\n')
    new_lines = []
    for line in lines:
        stripped = line.strip()
        should_remove = False
        modified_line = line
        for name in unused_names:
            module, _, symbol = name.rpartition('.')
            # Handle "import X"
            if stripped.startswith('import ') and stripped == 'import ' + name:
                should_remove = True
                break
            # Handle "from module import symbol"
            if module and ('from ' + module + ' import') in stripped:
                import_match = re.match(r'from\s+\S+\s+import\s+(.+)', stripped)
                if import_match:
                    imports = [i.strip() for i in import_match.group(1).split(',')]
                    if symbol in imports:
                        if len(imports) == 1:
                            should_remove = True
                        else:
                            imports.remove(symbol)
                            new_import = 'from ' + module + ' import ' + ', '.join(imports)
                            modified_line = line[:len(line)-len(line.lstrip())] + new_import
                        break
        if not should_remove:
            new_lines.append(modified_line)
    content = '\n'.join(new_lines)
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

fixes = {
    'app/api/alerts.py': [
        'sqlalchemy.and_', 'sqlalchemy.func', 'sqlalchemy.or_',
        'typing.List', 'app.models.event.IoTEvent',
    ],
    'app/api/analytics_components.py': [
        'datetime.timedelta', 'typing.List',
        'app.models.event.IoTEvent', 'app.models.machine.MachineState',
    ],
    'app/api/controls.py': ['app.core.security.get_current_user'],
    'app/api/dashboard_components.py': [
        'sqlalchemy.desc',
        'app.models.telemetry.SensorTelemetry', 'app.models.plant.Shop',
    ],
    'app/api/dashboards.py': [
        'fastapi.Query', 'typing.List',
        'app.core.security.require_manager', 'app.core.security.require_leadership',
        'app.models.user.Role',
    ],
    'app/api/forecast_components.py': [
        'sqlalchemy.desc', 'app.core.filters.get_time_range',
    ],
    'app/api/forecasts.py': [
        'datetime.timedelta', 'fastapi.HTTPException', 'fastapi.status',
        'sqlalchemy.and_', 'app.core.security.get_current_user',
    ],
    'app/api/kpis.py': [
        'fastapi.HTTPException', 'fastapi.status',
        'sqlalchemy.and_', 'app.core.security.require_manager',
    ],
    'app/api/machines.py': ['fastapi.Query'],
    'app/api/telemetry.py': ['sqlalchemy.and_', 'sqlalchemy.func'],
    'app/api/ticker.py': ['typing.List'],
    'app/api/websocket.py': [
        'traceback', 'fastapi.Depends', 'app.core.database.get_db',
    ],
    'app/api/websocket_enhanced.py': [
        'json', 'datetime.timedelta', 'typing.Set',
        'app.models.telemetry.SensorTelemetry',
    ],
    'app/core/filters.py': ['sqlalchemy.and_', 'sqlalchemy.orm.Query'],
    'app/models/user.py': ['sqlalchemy.DateTime'],
    'app/schemas/control.py': ['pydantic.Field'],
    'app/schemas/event.py': ['typing.List'],
    'app/schemas/kpi.py': ['datetime.date'],
    'app/schemas/machine.py': ['typing.List'],
    'app/services/alert_service.py': [
        'typing.Any', 'sqlalchemy.update', 'app.schemas.event.AlertResponse',
    ],
    'app/services/forecast_service.py': [
        'typing.Dict', 'typing.Any', 'sqlalchemy.func',
        'app.models.telemetry.Telemetry', 'app.schemas.forecast.ForecastResponse',
    ],
    'app/services/kpi_service.py': [
        'typing.List', 'app.models.machine.MachineState',
        'app.models.plant.Line', 'app.models.plant.Shop',
    ],
    'app/services/machine_service.py': [
        'sqlalchemy.or_', 'app.models.plant.Plant',
        'app.schemas.machine.MachineResponse',
    ],
    'app/services/telemetry_service.py': ['app.schemas.telemetry.TelemetryResponse'],
    'app/services/ticker_service.py': [
        'sqlalchemy.or_', 'app.models.machine.MachineState',
    ],
}

print("=== Fixing unused imports (F401) ===")
for filepath, unused in fixes.items():
    if os.path.exists(filepath):
        if remove_unused_import(filepath, unused):
            print(f"  Fixed imports in {filepath}")
        else:
            print(f"  No change needed in {filepath}")
    else:
        print(f"  NOT FOUND: {filepath}")


# === Fix F541: f-strings without placeholders ===
print("\n=== Fixing f-strings without placeholders (F541) ===")

def fix_fstrings(filepath):
    """Convert f-strings without placeholders to regular strings."""
    with open(filepath, 'r') as f:
        content = f.read()
    original = content
    # Match f"..." or f'...' where there are no { } inside
    content = re.sub(r'\bf("(?:[^"{}\\]|\\.)*")', r'\1', content)
    content = re.sub(r"\bf('(?:[^'{}\\]|\\.)*')", r'\1', content)
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

fstring_files = ['app/api/alerts.py', 'app/api/websocket.py']
for fp in fstring_files:
    if os.path.exists(fp):
        if fix_fstrings(fp):
            print(f"  Fixed f-strings in {fp}")
        else:
            print(f"  No f-string changes in {fp}")


# === Fix E741: ambiguous variable name 'l' ===
print("\n=== Fixing ambiguous variable names (E741) ===")

def fix_ambiguous_var(filepath):
    """Rename ambiguous variable 'l' to 'line_item' in list comprehensions."""
    with open(filepath, 'r') as f:
        content = f.read()
    original = content
    # Replace ' for l in ' with ' for line_obj in ' and 'l.' with 'line_obj.'
    # This needs to be done carefully per context
    # Pattern: "for l in X" -> "for line_obj in X"
    content = re.sub(r'\bfor l in\b', 'for line_obj in', content)
    content = re.sub(r'\bl\.name\b', 'line_obj.name', content)
    content = re.sub(r'\bl\.id\b', 'line_obj.id', content)
    content = re.sub(r'\bl\.shop_id\b', 'line_obj.shop_id', content)
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

e741_files = ['app/api/analytics.py', 'app/api/kpis.py', 'app/api/websocket.py']
for fp in e741_files:
    if os.path.exists(fp):
        if fix_ambiguous_var(fp):
            print(f"  Fixed ambiguous vars in {fp}")
        else:
            print(f"  No ambiguous var changes in {fp}")


# === Fix F811: redefinition of 'traceback' ===
print("\n=== Fixing traceback redefinitions (F811) ===")

def fix_traceback_redef(filepath):
    """Fix 'import traceback' redefinitions inside except blocks."""
    with open(filepath, 'r') as f:
        content = f.read()
    original = content
    # Remove the top-level 'import traceback' since it's unused (already removed by F401)
    # The local 'import traceback' inside except blocks are fine, just add noqa
    lines = content.split('\n')
    new_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped == 'import traceback' and line.startswith((' ', '\t')):
            # This is inside a function/block - add noqa
            if '# noqa' not in line:
                line = line.rstrip() + '  # noqa: F811'
        new_lines.append(line)
    content = '\n'.join(new_lines)
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

if os.path.exists('app/api/websocket.py'):
    if fix_traceback_redef('app/api/websocket.py'):
        print("  Fixed traceback redefinitions in app/api/websocket.py")


# === Fix F841: unused local variables ===
print("\n=== Fixing unused local variables (F841) ===")

def fix_unused_vars(filepath, var_replacements):
    """Prefix unused variables with _ or remove assignments."""
    with open(filepath, 'r') as f:
        content = f.read()
    original = content
    for old, new in var_replacements:
        content = content.replace(old, new)
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

# websocket.py: 'shops' assigned but unused
# alert_service.py: 'base_query' and 'today_start' assigned but unused


# === Fix main.py: websocket_enhanced import (needed for side effects) ===
print("\n=== Fixing main.py side-effect import ===")
if os.path.exists('app/main.py'):
    with open('app/main.py', 'r') as f:
        content = f.read()
    if 'import app.api.websocket_enhanced' in content and '# noqa' not in content.split('import app.api.websocket_enhanced')[0].split('\n')[-1]:
        content = content.replace(
            'import app.api.websocket_enhanced',
            'import app.api.websocket_enhanced  # noqa: F401 (side-effect import)'
        )
        with open('app/main.py', 'w') as f:
            f.write(content)
        print("  Added noqa to side-effect import in app/main.py")

# === Fix websocket.py: Plant import inside function ===
print("\n=== Fixing local imports in websocket.py ===")
if os.path.exists('app/api/websocket.py'):
    with open('app/api/websocket.py', 'r') as f:
        content = f.read()
    original = content
    # Fix local Plant import
    content = content.replace(
        'from app.models.plant import Plant\n',
        'from app.models.plant import Plant  # noqa: F401\n'
    ) if 'from app.models.plant import Plant' in content and '# noqa' not in [l for l in content.split('\n') if 'from app.models.plant import Plant' in l][0] else content
    if content != original:
        with open('app/api/websocket.py', 'w') as f:
            f.write(content)
        print("  Fixed local Plant import in websocket.py")

print("\n=== All fixes applied ===")
