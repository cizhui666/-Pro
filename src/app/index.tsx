import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QUERY_MAX_ATTEMPTS, query, QueryError, type QueryResult } from '../lib/api';

type HistoryItem = {
  id: string;
  keyword: string;
  at: number;
};

const MAX_HISTORY = 20;

export default function QueryScreen() {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(1);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [loading]);

  const runQuery = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || loading) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setResult(null);
      setShowRaw(false);
      setAttempt(1);

      try {
        const data = await query(trimmed, controller.signal, setAttempt);
        if (controller.signal.aborted) return;
        setResult(data);
        setHistory((prev) => {
          const next = [
            { id: `${Date.now()}`, keyword: trimmed, at: Date.now() },
            ...prev.filter((item) => item.keyword !== trimmed),
          ];
          return next.slice(0, MAX_HISTORY);
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        setResult(null);
        if (e instanceof QueryError && e.kind === 'cancelled') {
          setError('已取消查询');
        } else {
          setError(e instanceof Error ? e.message : '查询失败，请稍后重试');
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [loading],
  );

  const onCancel = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setError('已取消查询');
  }, []);

  const onSubmit = useCallback(() => {
    void runQuery(keyword);
  }, [keyword, runQuery]);

  const onPickHistory = useCallback(
    (value: string) => {
      setKeyword(value);
      void runQuery(value);
    },
    [runQuery],
  );

  const onCopy = useCallback(async () => {
    if (!result) return;
    await Clipboard.setStringAsync(showRaw ? result.raw : result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [result, showRaw]);

  const canSubmit = keyword.trim().length > 0 && !loading;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.header}>
            <Text style={styles.title}>查询工具</Text>
            <Text style={styles.subtitle}>输入内容，实时获取接口返回</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>查询内容</Text>
            <TextInput
              style={styles.input}
              value={keyword}
              onChangeText={setKeyword}
              placeholder="请输入要查询的内容"
              placeholderTextColor="#9AA3B2"
              returnKeyType="search"
              onSubmitEditing={onSubmit}
              editable={!loading}
              multiline
              maxLength={500}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.row}>
              <Pressable
                onPress={() => setKeyword('')}
                disabled={!keyword || loading}
                style={({ pressed }) => [
                  styles.btnGhost,
                  pressed && styles.pressed,
                  (!keyword || loading) && styles.btnDisabled,
                ]}
              >
                <Text style={styles.btnGhostText}>清空</Text>
              </Pressable>
              <Pressable
                onPress={onSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  pressed && styles.pressed,
                  !canSubmit && styles.btnDisabled,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.btnPrimaryText}>查询</Text>
                )}
              </Pressable>
            </View>
          </View>

          {loading ? (
            <View style={styles.card}>
              <View style={styles.stateBox}>
                <ActivityIndicator color="#2563EB" />
                <Text style={styles.stateText}>
                  正在查询… {elapsed} 秒
                  {attempt > 1 ? `（第 ${attempt}/${QUERY_MAX_ATTEMPTS} 次尝试）` : ''}
                </Text>
                <Pressable
                  onPress={onCancel}
                  style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
                >
                  <Text style={styles.tagText}>取消</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {error ? (
            <View style={[styles.card, styles.errorCard]}>
              <Text style={styles.errorTitle}>查询失败</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {result ? (
            <View style={styles.card}>
              <View style={styles.resultHeader}>
                <Text style={styles.label}>查询结果</Text>
                <View style={styles.resultActions}>
                  {result.isJson ? (
                    <Pressable
                      onPress={() => setShowRaw((v) => !v)}
                      style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
                    >
                      <Text style={styles.tagText}>{showRaw ? '格式化' : '原始'}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => void onCopy()}
                    style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
                  >
                    <Text style={styles.tagText}>{copied ? '已复制' : '复制'}</Text>
                  </Pressable>
                </View>
              </View>
              <Text selectable style={styles.resultText}>
                {showRaw ? result.raw : result.text}
              </Text>
            </View>
          ) : null}

          {history.length > 0 ? (
            <View style={styles.card}>
              <View style={styles.resultHeader}>
                <Text style={styles.label}>历史记录</Text>
                <Pressable
                  onPress={() => setHistory([])}
                  style={({ pressed }) => [styles.tag, pressed && styles.pressed]}
                >
                  <Text style={styles.tagText}>清空</Text>
                </Pressable>
              </View>
              {history.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => onPickHistory(item.keyword)}
                  style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}
                >
                  <Text numberOfLines={1} style={styles.historyText}>
                    {item.keyword}
                  </Text>
                  <Text style={styles.historyTime}>
                    {new Date(item.at).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#F1F4F9' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
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
  label: { fontSize: 13, fontWeight: '600', color: '#64748B', marginBottom: 8 },
  input: {
    minHeight: 76,
    fontSize: 16,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btnPrimary: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  btnGhost: {
    height: 46,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostText: { color: '#475569', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.45 },
  pressed: { opacity: 0.65 },
  stateBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  stateText: { flex: 1, fontSize: 15, color: '#475569' },
  errorCard: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  errorTitle: { fontSize: 14, fontWeight: '700', color: '#DC2626', marginBottom: 4 },
  errorText: { fontSize: 14, color: '#B91C1C', lineHeight: 21 },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  resultActions: { flexDirection: 'row', gap: 8 },
  tag: {
    paddingHorizontal: 12,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { color: '#2563EB', fontSize: 13, fontWeight: '600' },
  resultText: {
    fontSize: 15,
    lineHeight: 23,
    color: '#0F172A',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
  },
  historyText: { flex: 1, fontSize: 15, color: '#334155' },
  historyTime: { fontSize: 12, color: '#94A3B8' },
});
