import { router } from 'expo-router';
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
import { EMAIL_MAX_LENGTH, EMAIL_PATTERN, sanitizeEmail, ui } from '../lib/ui';
import { useQueryRunner } from '../lib/useQuery';

export default function EmailQueryScreen() {
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
    runQuery,
    pick,
    cancel,
    clearHistory,
    copy,
  } = useQueryRunner();

  const onSubmit = () => {
    if (!EMAIL_PATTERN.test(keyword)) {
      setError('请输入正确的邮箱地址');
      return;
    }
    void runQuery(keyword);
  };

  const canSubmit = EMAIL_PATTERN.test(keyword) && !loading;
  const hintColor = keyword.length === 0 ? '#94A3B8' : canSubmit ? '#16A34A' : '#DC2626';

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
            <Text style={ui.title}>邮箱查询</Text>
            <Text style={ui.subtitle}>词缀-综合</Text>
          </View>

          <View style={ui.card}>
            <Text style={ui.label}>邮箱</Text>
            <TextInput
              style={ui.singleInput}
              value={keyword}
              onChangeText={(text) => setKeyword(sanitizeEmail(text))}
              placeholder="请输入邮箱地址"
              placeholderTextColor="#9AA3B2"
              keyboardType="email-address"
              returnKeyType="search"
              onSubmitEditing={onSubmit}
              editable={!loading}
              maxLength={EMAIL_MAX_LENGTH}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={[ui.hint, { color: hintColor }]}>
              需为 用户名@域名.后缀 格式 · 已输入 {keyword.length} 位
            </Text>
            <View style={ui.row}>
              <Pressable
                onPress={() => setKeyword('')}
                disabled={!keyword || loading}
                style={({ pressed }) => [
                  ui.btnGhost,
                  pressed && ui.pressed,
                  (!keyword || loading) && ui.btnDisabled,
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
