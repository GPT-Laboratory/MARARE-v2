"""
Run async coroutines safely from synchronous Flask route handlers.

Flask views are sync; MCP and OAuth helpers are async. This helper either runs
asyncio.run directly or delegates to a thread pool when a loop is already active.
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor

def run_async(coro):
    """Helper to run async code in Flask"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    
    with ThreadPoolExecutor(max_workers=1) as executor:
        return executor.submit(asyncio.run, coro).result()