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
import { ID_LENGTH, ID_PATTERN, sanitizeIdCard, ui } from '../lib/ui';
import { useQueryRunner } from '../lib/useQuery';

export default function IdCardQueryScreen() {
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
    if (!ID_PATTERN.test(keyword)) {
      setError(`请输入 ${ID_LENGTH} 位身份证号`);
      return;
    }
    void runQuery(keyword);
  };

  const digits = keyword.length;
  const canSubmit = ID_PATTERN.test(keyword) && !loading;
  const hintColor = digits === 0 ? '#94A3B8' : canSubmit ? '#16A34A' : '#DC2626';

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
            <Text style={ui.title}>身份证号查询</Text>
            <Text style={ui.subtitle}>词缀-情报局</Text>
          </View>

          <View style={ui.card}>
            <Text style={ui.label}>身份证号</Text>
            <TextInput
              style={ui.singleInput}
              value={keyword}
              onChangeText={(text) => setKeyword(sanitizeIdCard(text))}
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
            <Text style={[ui.hint, { color: hintColor }]}>
              仅支持 {ID_LENGTH} 位身份证号（末位可为 X）· 已输入 {digits}/{ID_LENGTH}
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
