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
import { ui } from '../lib/ui';
import { useQueryRunner } from '../lib/useQuery';

export default function QueryScreen() {
  const {
    keyword,
    setKeyword,
    loading,
    error,
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
  } = useQueryRunner();

  const canSubmit = keyword.trim().length > 0 && !loading;

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
            <Text style={ui.title}>综合查询</Text>
            <Text style={ui.subtitle}>词缀-综合</Text>
          </View>

          <View style={ui.card}>
            <Text style={ui.label}>查询内容</Text>
            <TextInput
              style={ui.input}
              value={keyword}
              onChangeText={setKeyword}
              placeholder="请输入要查询的内容"
              placeholderTextColor="#9AA3B2"
              returnKeyType="search"
              onSubmitEditing={submit}
              editable={!loading}
              multiline
              maxLength={500}
              autoCapitalize="none"
              autoCorrect={false}
            />
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
                onPress={submit}
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
