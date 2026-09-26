import { router } from 'expo-router';
import { useCallback, useState } from 'react';
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

import { ErrorCard, HistoryCard, LoadingCard, ResultCard } from '../components/QueryPanels';
import { queryLieMo } from '../lib/api';
import { NAME_MAX_LENGTH, REGION_MAX_LENGTH, sanitizeName, sanitizeRegion, ui } from '../lib/ui';
import { useQueryRunner } from '../lib/useQuery';

export default function LieMoQueryScreen() {
  const [region, setRegion] = useState('');

  const submitFn = useCallback(
    (name: string, signal: AbortSignal, onAttempt: (attempt: number) => void) =>
      queryLieMo(name, region, signal, onAttempt),
    [region],
  );

  const {
    keyword,
    setKeyword,
    loading,
    error,
    setError,
    result,
    showRaw,
    setShowRaw,
    history,
    copied,
    attempt,
    elapsed,
    submit,
    pick,
    cancel,
    clearHistory,
    copy,
  } = useQueryRunner(submitFn);

  const onSubmit = () => {
    if (!keyword) {
      setError('请输入姓名');
      return;
    }
    submit();
  };

  const canSubmit = keyword.length > 0 && !loading;

  return (
    <SafeAreaView style={ui.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={ui.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={ui.flex}
          contentContainerStyle={ui.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={ui.header}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [ui.back, pressed && ui.pressed]}
            >
              <Text style={ui.backText}>‹ 返回</Text>
            </Pressable>
            <Text style={ui.title}>猎魔查询</Text>
            <Text style={ui.subtitle}>词缀-猎魔数据</Text>
          </View>

          <View style={ui.card}>
            <Text style={ui.label}>姓名</Text>
            <TextInput
              style={ui.singleInput}
              value={keyword}
              onChangeText={(text) => setKeyword(sanitizeName(text))}
              placeholder="请输入姓名"
              placeholderTextColor="#9AA3B2"
              returnKeyType="search"
              onSubmitEditing={onSubmit}
              editable={!loading}
              maxLength={NAME_MAX_LENGTH}
              autoCorrect={false}
            />
            <Text style={[ui.hint, { color: keyword ? '#16A34A' : '#94A3B8' }]}>
              姓名必填 · 已输入 {keyword.length}/{NAME_MAX_LENGTH}
            </Text>

            <Text style={[ui.label, ui.labelSpaced]}>地区（选填）</Text>
            <TextInput
              style={ui.singleInput}
              value={region}
              onChangeText={(text) => setRegion(sanitizeRegion(text))}
              placeholder="如：北京，留空查全部"
              placeholderTextColor="#9AA3B2"
              returnKeyType="search"
              onSubmitEditing={onSubmit}
              editable={!loading}
              maxLength={REGION_MAX_LENGTH}
              autoCorrect={false}
            />
            <Text style={ui.hint}>留空查询全部地区，返回的数据量会大很多</Text>

            <View style={ui.row}>
              <Pressable
                onPress={() => {
                  setKeyword('');
                  setRegion('');
                }}
                disabled={(!keyword && !region) || loading}
                style={({ pressed }) => [
                  ui.btnGhost,
                  pressed && ui.pressed,
                  ((!keyword && !region) || loading) && ui.btnDisabled,
                ]}
              >
                <Text style={ui.btnGhostText}>清空</Text>
              </Pressable>
              <Pressable
                onPress={onSubmit}
                disabled={!canSubmit}
                style={({ pressed }) => [
                  ui.btnPrimary,
                  pressed && ui.pressed,
                  !canSubmit && ui.btnDisabled,
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={ui.btnPrimaryText}>查询</Text>
                )}
              </Pressable>
            </View>
          </View>

          {loading ? <LoadingCard elapsed={elapsed} attempt={attempt} onCancel={cancel} /> : null}

          {error ? <ErrorCard message={error} /> : null}

          {result ? (
            <ResultCard
              result={result}
              showRaw={showRaw}
              copied={copied}
              onToggleRaw={() => setShowRaw((v) => !v)}
              onCopy={() => void copy()}
            />
          ) : null}

          {history.length > 0 ? (
            <HistoryCard items={history} onPick={pick} onClear={clearHistory} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
