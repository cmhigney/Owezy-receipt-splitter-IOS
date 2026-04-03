import { useState, useCallback } from 'react';
import createContextHook from '@nkzw/create-context-hook';
import { ReceiptItem, Friend, AutoGratuityInfo, TipSplitMode } from '@/types';

const DEFAULT_AUTO_GRATUITY_INFO: AutoGratuityInfo = {
  detected: false,
  partySizeMin: null,
  policyText: null,
  includedInTotal: false,
  autoGratuityAmount: null,
  additionalTipAmount: null,
};

export const [SplitFlowProvider, useSplitFlow] = createContextHook(() => {
  const [restaurantName, setRestaurantName] = useState<string>('');
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [subtotal, setSubtotal] = useState<number>(0);
  const [tax, setTax] = useState<number>(0);
  const [tip, setTip] = useState<number>(0);
  const [pendingAutoTipAmount, setPendingAutoTipAmount] = useState<number | null>(null);
  const [tipSplitMode, setTipSplitMode] = useState<TipSplitMode>('proportional');
  const [tipDetectedFromReceipt, setTipDetectedFromReceipt] = useState<boolean>(false);
  const [autoGratuityInfo, setAutoGratuityInfo] = useState<AutoGratuityInfo>(
    DEFAULT_AUTO_GRATUITY_INFO,
  );
  const [people, setPeople] = useState<Friend[]>([]);
  const [editingSplitId, setEditingSplitId] = useState<string | null>(null);
  const [hasFees, setHasFees] = useState<boolean>(false);
  const [splitConfirmed, setSplitConfirmed] = useState<boolean>(false);

  const reset = useCallback(() => {
    setRestaurantName('');
    setItems([]);
    setSubtotal(0);
    setTax(0);
    setTip(0);
    setPendingAutoTipAmount(null);
    setTipSplitMode('proportional');
    setTipDetectedFromReceipt(false);
    setAutoGratuityInfo(DEFAULT_AUTO_GRATUITY_INFO);
    setPeople([]);
    setEditingSplitId(null);
    setHasFees(false);
    setSplitConfirmed(false);
  }, []);

  const updateItemAssignment = useCallback((itemId: string, personId: string) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== itemId) return item;
        const isAssigned = item.assignedTo.includes(personId);
        return {
          ...item,
          assignedTo: isAssigned
            ? item.assignedTo.filter((id) => id !== personId)
            : [...item.assignedTo, personId],
        };
      }),
    );
  }, []);

  const assignAllToMe = useCallback((meId: string) => {
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        assignedTo: item.assignedTo.length === 0 ? [meId] : item.assignedTo,
      })),
    );
  }, []);

  return {
    restaurantName, setRestaurantName,
    items, setItems,
    subtotal, setSubtotal,
    tax, setTax,
    tip, setTip,
    pendingAutoTipAmount, setPendingAutoTipAmount,
    tipSplitMode, setTipSplitMode,
    tipDetectedFromReceipt, setTipDetectedFromReceipt,
    autoGratuityInfo, setAutoGratuityInfo,
    people, setPeople,
    editingSplitId, setEditingSplitId,
    hasFees, setHasFees,
    splitConfirmed, setSplitConfirmed,
    updateItemAssignment,
    assignAllToMe,
    reset,
  };
});
