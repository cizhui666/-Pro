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

  // 姓名和地区要支持中文，这里必须让原生输入框自己持有文本，不能回写 value。
  //
  // React Native 的 TextInput 是受控组件：只要传了 value，原生文本就会被强制
  // 对齐到它。拼音输入法在组合过程中会通过 onChangeText 送出 marked text
  // （peng、xi'an 之类），一旦把这个中间态写回 value，原生的组合区就被重置、
  // 候选窗随之消失，输入法会把已输入的音节当作已上屏并送出回车，于是打
  // 「peng」到第二个字母就被提交。
  //
  // 所以这里只单向读取：onChangeText 更新 state 用于计数和提交，不传 value。
  // RN 0.83 已经移除了 onCompositionStart/onCompositionEnd，无法在组合期间
  // 精确识别，非受控是目前唯一可靠的做法。
  // 需要程序化改写输入框内容时（清空按钮、历史回填）用 key 重新挂载，
  // 让 defaultValue 重新生效。
  const [nameEpoch, bumpNameEpoch] = useState(0);
  const [regionEpoch, bumpRegionEpoch] = useState(0);

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

  // 历史回填：state 走pick，界面靠重新挂载同步到输入框。
  const onPick = useCallback(
    (value: string) => {
      setKeyword(value);
      bumpNameEpoch((n) => n + 1);
      pick(value);
    },
    [bumpNameEpoch, pick, setKeyword],
  );

  const onClear = useCallback(() => {
    setKeyword('');
    setRegion('');
    bumpNameEpoch((n) => n + 1);
    bumpRegionEpoch((n) => n + 1);
  }, [bumpNameEpoch, bumpRegionEpoch, setKeyword]);

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
              key={`name-${nameEpoch}`}
              style={ui.singleInput}
              defaultValue={keyword}
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
              key={`region-${regionEpoch}`}
              style={ui.singleInput}
              defaultValue={region}
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
                onPress={onClear}
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
            <HistoryCard items={history} onPick={onPick} onClear={clearHistory} />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
