import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QUERY_MAX_ATTEMPTS, query, QueryError, type QueryResult } from '../lib/api';
import { ID_LENGTH, ID_PATTERN, sanitizeIdCard, ui } from '../lib/ui';

type HistoryItem = {
  id: string;
  keyword: string;
  at: number;
};

const MAX_HISTORY = 20;

export default function IdCardQueryScreen() {
  const [idCard, setIdCard] = useState('');
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
    if (!ID_PATTERN.test(idCard)) {
      setError(`请输入 ${ID_LENGTH} 位身份证号`);
      return;
    }
    void runQuery(idCard);
  }, [idCard, runQuery]);

  const onChange = useCallback((text: string) => {
    setIdCard(sanitizeIdCard(text));
  }, []);

  const onPickHistory = useCallback(
    (value: string) => {
      setIdCard(value);
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

  const digits = idCard.length;
  const canSubmit = ID_PATTERN.test(idCard) && !loading;
  const hintColor = digits === 0 ? '#94A3B8' : canSubmit ? '#16A34A' : '#DC2626';

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
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
            >
              <Text style={styles.backText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.title}>身份证号查询</Text>
            <Text style={styles.subtitle}>词缀-情报局</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>身份证号</Text>
            <TextInput
              style={styles.singleInput}
              value={idCard}
              onChangeText={onChange}
              placeholder={`请输入 ${ID_LENGTH} 位身份证号`}
              placeholderTextColor="#9AA3B2"
              keyboardType="numbers-and-punctuation"
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={onSubmit}
              editable={!loading}
              maxLength={ID_LENGTH}
              autoCorrect={false}
            />
            <Text style={[styles.hint, { color: hintColor }]}>
              仅支持 {ID_LENGTH} 位身份证号（末位可为 X）· 已输入 {digits}/{ID_LENGTH}
            </Text>
            <View style={styles.row}>
              <Pressable
                onPress={() => setIdCard('')}
                disabled={!idCard || loading}
                style={({ pressed }) => [
                  styles.btnGhost,
                  pressed && styles.pressed,
                  (!idCard || loading) && styles.btnDisabled,
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

const styles = ui;
