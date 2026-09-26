import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { QUERY_MAX_ATTEMPTS, type QueryResult } from '../lib/api';
import { ui } from '../lib/ui';

type HistoryItem = {
  id: string;
  keyword: string;
  at: number;
};

export function LoadingCard({
  elapsed,
  attempt,
  onCancel,
}: {
  elapsed: number;
  attempt: number;
  onCancel: () => void;
}) {
  return (
    <View style={ui.card}>
      <View style={ui.stateBox}>
        <ActivityIndicator color="#2563EB" />
        <Text style={ui.stateText}>
          正在查询… {elapsed} 秒
          {attempt > 1 ? `（第 ${attempt}/${QUERY_MAX_ATTEMPTS} 次尝试）` : ''}
        </Text>
        <Pressable onPress={onCancel} style={({ pressed }) => [ui.tag, pressed && ui.pressed]}>
          <Text style={ui.tagText}>取消</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <View style={[ui.card, ui.errorCard]}>
      <Text style={ui.errorTitle}>查询失败</Text>
      <Text style={ui.errorText}>{message}</Text>
    </View>
  );
}

export function ResultCard({
  result,
  showRaw,
  copied,
  onToggleRaw,
  onCopy,
}: {
  result: QueryResult;
  showRaw: boolean;
  copied: boolean;
  onToggleRaw: () => void;
  onCopy: () => void;
}) {
  return (
    <View style={ui.card}>
      <View style={ui.resultHeader}>
        <Text style={ui.label}>查询结果</Text>
        <View style={ui.resultActions}>
          {result.isJson ? (
            <Pressable
              onPress={onToggleRaw}
              style={({ pressed }) => [ui.tag, pressed && ui.pressed]}
            >
              <Text style={ui.tagText}>{showRaw ? '格式化' : '原始'}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onCopy} style={({ pressed }) => [ui.tag, pressed && ui.pressed]}>
            <Text style={ui.tagText}>{copied ? '已复制' : '复制'}</Text>
          </Pressable>
        </View>
      </View>
      <Text selectable style={ui.resultText}>
        {showRaw ? result.raw : result.text}
      </Text>
    </View>
  );
}

export function HistoryCard({
  items,
  onPick,
  onClear,
}: {
  items: HistoryItem[];
  onPick: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <View style={ui.card}>
      <View style={ui.resultHeader}>
        <Text style={ui.label}>历史记录</Text>
        <Pressable onPress={onClear} style={({ pressed }) => [ui.tag, pressed && ui.pressed]}>
          <Text style={ui.tagText}>清空</Text>
        </Pressable>
      </View>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onPick(item.keyword)}
          style={({ pressed }) => [ui.historyRow, pressed && ui.pressed]}
        >
          <Text numberOfLines={1} style={ui.historyText}>
            {item.keyword}
          </Text>
          <Text style={ui.historyTime}>
            {new Date(item.at).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
