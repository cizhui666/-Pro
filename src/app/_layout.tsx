import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LicenseGate } from '../components/LicenseGate';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <LicenseGate>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </LicenseGate>
    </SafeAreaProvider>
  );
}
