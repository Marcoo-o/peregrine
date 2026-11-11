/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { registerAutoBackup } from './src/background/registerAutoBackup';
import { registerBackgroundSync } from './src/background/registerBackgroundSync';
import { registerNotificationAction } from './src/background/registerNotificationAction';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

// The look for new mail that the platform's scheduler starts while the application is closed.
registerBackgroundSync();
registerAutoBackup();
// The buttons of a notification ("Archive", "Mark read"), which act on a message without the application being opened.
registerNotificationAction();
