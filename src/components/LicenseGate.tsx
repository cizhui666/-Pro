import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  LicenseError,
  getLicenseState,
  restoreLicense,
  subscribeLicense,
  verifyCard,
} from '../lib/license';

const TYPE_LABELS: Record<string, string> = {
  longuse: '永久卡',
  year: '年卡',
  season: '季卡',
  month: '月卡',
  week: '周卡',
  day: '天卡',
  hour: '时卡',
  single: '次数卡',
  free: '免费',
};

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '未知';
  const d = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function describe(vip: number, kmtype: string): string {
  if (kmtype === 'longuse') return '永久有效';
  const label = TYPE_LABELS[kmtype] ?? '卡密';
  return `${label} · 到期 ${formatDate(vip)}`;
}

export function LicenseGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  const [licensed, setLicensed] = useState(false);
  const [card, setCard] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const restored = await restoreLicense();
        if (!alive) return;
        if (restored) {
          setCard(restored.card);
          const info = await verifyCard(restored.card);
          if (!alive) return;
          setSummary(describe(info.vip, info.kmtype));
          setLicensed(true);
        }
      } catch (e) {
        if (!alive) return;
        if (e instanceof LicenseError) setError(e.message);
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(
    () =>
      subscribeLicense(() => {
        if (!getLicenseState()) {
          setLicensed(false);
          setSummary('');
        }
      }),
    [],
  );

  const submit = useCallback(async () => {
    const value = card.trim();
    if (!value) {
      setError('请输入卡密');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const info = await verifyCard(value);
      setSummary(describe(info.vip, info.kmtype));
      setLicensed(true);
    } catch (e) {
      // 兜底不得吞掉真实异常，否则线上问题无法定位。
      setError(
        e instanceof LicenseError
          ? e.message
          : `验证失败，请重试（${e instanceof Error ? e.message : String(e)}）`,
      );
    } finally {
      setBusy(false);
    }
  }, [card]);

  if (licensed) {
    return <>{children}</>;
  }

  return (
    <Modal visible animationType="fade" transparent={false}>
      <KeyboardAvoidingView
        style={styles.wrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.panel}>
          <Text style={styles.title}>词社</Text>
          <Text style={styles.subtitle}>请输入卡密后使用</Text>

          {checking ? (
            <View style={styles.stateBox}>
              <ActivityIndicator color="#2563EB" />
              <Text style={styles.stateText}>正在验证卡密…</Text>
            </View>
          ) : (
            <>
              <TextInput
                value={card}
                onChangeText={(text) => {
                  setCard(text);
                  if (error) setError('');
                }}
                placeholder="请输入卡密"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                returnKeyType="go"
                onSubmitEditing={submit}
                editable={!busy}
              />

              {summary ? <Text style={styles.ok}>{summary}</Text> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Pressable
                onPress={submit}
                disabled={busy}
                style={({ pressed }) => [
                  styles.btn,
                  busy && styles.btnDisabled,
                  pressed && styles.pressed,
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.btnText}>验证并进入</Text>
                )}
              </Pressable>

              <Text style={styles.hint}>卡密与本机设备绑定，一机一码</Text>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#F1F4F9', justifyContent: 'center' },
  panel: { margin: 24, padding: 24, borderRadius: 20, backgroundColor: '#FFFFFF' },
  title: { fontSize: 26, fontWeight: '700', color: '#0F172A' },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6, marginBottom: 20 },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  stateText: { fontSize: 15, color: '#475569' },
  input: {
    height: 52,
    fontSize: 17,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
  },
  ok: { fontSize: 13, color: '#15803D', marginTop: 12 },
  error: { fontSize: 13, color: '#DC2626', marginTop: 12, lineHeight: 19 },
  btn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, color: '#94A3B8', marginTop: 14, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
