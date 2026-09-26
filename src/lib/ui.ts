import { Platform, StyleSheet } from 'react-native';

export const ui = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: '#F1F4F9' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  header: { marginTop: 8, marginBottom: 4, gap: 10 },
  back: {
    alignSelf: 'flex-start',
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 15,
    backgroundColor: '#EEF2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: '#475569', fontSize: 14, fontWeight: '600' },
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
  labelSpaced: { marginTop: 16 },
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
  singleInput: {
    height: 52,
    fontSize: 18,
    letterSpacing: 2,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    textAlignVertical: 'center',
  },
  hint: { fontSize: 12, marginTop: 8 },
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

export const PHONE_LENGTH = 11;
export const PHONE_PATTERN = /^\d{11}$/;
export const ID_LENGTH = 18;
export const ID_PATTERN = /^\d{17}[\dX]$/;
export const QQ_MIN_LENGTH = 5;
export const QQ_MAX_LENGTH = 11;
export const QQ_PATTERN = /^\d{5,11}$/;
export const EMAIL_MAX_LENGTH = 254;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const NAME_MAX_LENGTH = 20;
export const REGION_MAX_LENGTH = 20;

export function sanitizeName(text: string): string {
  return text.replace(/\s/g, '').slice(0, NAME_MAX_LENGTH);
}

export function sanitizeRegion(text: string): string {
  return text.replace(/\s/g, '').slice(0, REGION_MAX_LENGTH);
}

export function sanitizePhone(text: string): string {
  return text.replace(/\D/g, '').slice(0, PHONE_LENGTH);
}

export function sanitizeIdCard(text: string): string {
  return text.toUpperCase().replace(/[^0-9X]/g, '').slice(0, ID_LENGTH);
}

export function sanitizeQq(text: string): string {
  return text.replace(/\D/g, '').slice(0, QQ_MAX_LENGTH);
}

export function sanitizeEmail(text: string): string {
  return text.trim().slice(0, EMAIL_MAX_LENGTH);
}
