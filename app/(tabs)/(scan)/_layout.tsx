import { Stack, router } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useTheme } from "@/contexts/ThemeContext";

export default function ScanLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.headerBg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' as const, fontSize: 17 },
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" options={{ title: "Owezy" }} />
      <Stack.Screen
        name="items"
        options={{
          title: "Edit Items",
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={10}
              style={{ marginLeft: 4 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>Back</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="tip"
        options={{
          title: "Tip",
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>Back</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="people"
        options={{
          title: "Who's Splitting?",
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>Back</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="assign"
        options={{
          title: "Assign Items",
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>Back</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="summary"
        options={{
          title: "Summary",
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: 4 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <ChevronLeft color={colors.text} size={22} strokeWidth={2.4} />
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: "600" }}>Back</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="pay"
        options={{
          title: "Payment",
          headerBackVisible: false,
          gestureEnabled: false,
          headerLeft: () => null,
          animation: 'slide_from_bottom',
        }}
      />
    </Stack>
  );
}
