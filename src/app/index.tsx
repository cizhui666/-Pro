import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>词社</Text>
          <Text style={styles.subtitle}>词缀-情报局</Text>
        </View>

        <Pressable
          onPress={() => router.push('/query')}
          style={({ pressed }) => [styles.card, styles.action, pressed && styles.pressed]}
        >
          <View style={styles.actionBody}>
            <Text style={styles.actionTitle}>情报局综合</Text>
            <Text style={styles.actionDesc}>综合查询</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/phone')}
          style={({ pressed }) => [styles.card, styles.action, pressed && styles.pressed]}
        >
          <View style={styles.actionBody}>
            <Text style={styles.actionTitle}>手机号查询</Text>
            <Text style={styles.actionDesc}>仅支持 11 位手机号</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/idcard')}
          style={({ pressed }) => [styles.card, styles.action, pressed && styles.pressed]}
        >
          <View style={styles.actionBody}>
            <Text style={styles.actionTitle}>身份证号查询</Text>
            <Text style={styles.actionDesc}>仅支持 18 位身份证号</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/qq')}
          style={({ pressed }) => [styles.card, styles.action, pressed && styles.pressed]}
        >
          <View style={styles.actionBody}>
            <Text style={styles.actionTitle}>QQ号查询</Text>
            <Text style={styles.actionDesc}>仅支持 5~11 位 QQ 号</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <Pressable
          onPress={() => router.push('/email')}
          style={({ pressed }) => [styles.card, styles.action, pressed && styles.pressed]}
        >
          <View style={styles.actionBody}>
            <Text style={styles.actionTitle}>邮箱查询</Text>
            <Text style={styles.actionDesc}>需为 用户名@域名.后缀 格式</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F1F4F9' },
  content: { flex: 1, padding: 16, gap: 12 },
  header: { marginTop: 8, marginBottom: 4 },
  title: { fontSize: 28, fontWeight: '700', color: '#0F172A', letterSpacing: 0.5 },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 4 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
  },
  action: { flexDirection: 'row', alignItems: 'center', minHeight: 72 },
  actionBody: { flex: 1, gap: 4 },
  actionTitle: { fontSize: 17, fontWeight: '600', color: '#0F172A' },
  actionDesc: { fontSize: 13, color: '#64748B' },
  chevron: { fontSize: 26, color: '#94A3B8', marginLeft: 12 },
  pressed: { opacity: 0.65 },
});
