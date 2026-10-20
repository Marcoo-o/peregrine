/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { registerBackgroundSync } from './src/background/registerBackgroundSync';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);

// The look for new mail that the platform's scheduler starts while the application is closed.
registerBackgroundSync();
