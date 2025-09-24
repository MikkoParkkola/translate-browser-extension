describe('background secure storage migration', () => {
  let onInstalledListener;
  
  beforeEach(() => {
    jest.resetModules();
    
    // Mock Chrome APIs
    global.chrome = {
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      runtime: { 
        onInstalled: { addListener: jest.fn(fn => onInstalledListener = fn) },
        onMessage: { addListener: jest.fn() },
        onConnect: { addListener: jest.fn() }
      },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: { 
        sync: { get: jest.fn((_, cb) => cb({ requestLimit: 60, tokenLimit: 60 })) },
        local: { get: jest.fn(), set: jest.fn() }
      }
    };
    
    global.importScripts = () => {};
    global.setInterval = () => {};
    
    // Mock secure storage with migration function
    global.qwenSecureStorage = {
      migrateToSecureStorage: jest.fn().mockResolvedValue()
    };
    
    // Mock throttle and other globals
    global.qwenThrottle = { 
      configure: jest.fn(),
      getUsage: jest.fn(() => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 60 }))
    };
    global.qwenErrorHandler = {
      handle: jest.fn(),
      handleAsync: jest.fn((promise) => promise),
      safe: jest.fn((fn) => fn)
    };
    
    // Mock console.log to capture logger output
    global.console = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn()
    };
    
    // Initialize background script
    require('../src/background.js');
  });
  
  test('triggers secure storage migration on extension install', async () => {
    expect(onInstalledListener).toBeDefined();
    
    // Simulate extension install
    await onInstalledListener({ reason: 'install' });
    
    // Verify migration was called
    expect(global.qwenSecureStorage.migrateToSecureStorage).toHaveBeenCalledTimes(1);
    
    // Check that success message was logged
    expect(console.info).toHaveBeenCalledWith('Starting API key secure storage migration...');
    expect(console.info).toHaveBeenCalledWith('API key secure storage migration completed');
  });
  
  test('triggers secure storage migration on extension update', async () => {
    expect(onInstalledListener).toBeDefined();
    
    // Simulate extension update
    await onInstalledListener({ reason: 'update' });
    
    // Verify migration was called
    expect(global.qwenSecureStorage.migrateToSecureStorage).toHaveBeenCalledTimes(1);
    
    // Check that success message was logged
    expect(console.info).toHaveBeenCalledWith('Starting API key secure storage migration...');
    expect(console.info).toHaveBeenCalledWith('API key secure storage migration completed');
  });
  
  test('handles secure storage migration failure gracefully', async () => {
    // Mock migration failure
    const migrationError = new Error('Migration failed');
    global.qwenSecureStorage.migrateToSecureStorage.mockRejectedValue(migrationError);
    
    expect(onInstalledListener).toBeDefined();
    
    // Simulate extension install - should not throw
    await expect(onInstalledListener({ reason: 'install' })).resolves.toBeUndefined();
    
    // Verify migration was attempted
    expect(global.qwenSecureStorage.migrateToSecureStorage).toHaveBeenCalledTimes(1);
    
    // Check that error was logged
    expect(console.warn).toHaveBeenCalledWith('API key secure storage migration failed:', migrationError);
  });
  
  test('skips migration when secure storage not available', async () => {
    // Remove secure storage mock
    delete global.qwenSecureStorage;
    
    expect(onInstalledListener).toBeDefined();
    
    // Simulate extension install - should not throw
    await expect(onInstalledListener({ reason: 'install' })).resolves.toBeUndefined();
    
    // Should not have any migration-related logs
    expect(console.info).not.toHaveBeenCalledWith(
      expect.stringContaining('secure storage migration')
    );
  });
});