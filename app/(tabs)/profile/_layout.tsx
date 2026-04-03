import { Stack } from "expo-router";
import React from "react";
import { useTheme } from "@/contexts/ThemeContext";

export default function ProfileLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.headerBg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' as const, fontSize: 17 },
        contentStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: "Profile" }} />
      <Stack.Screen name="pro" options={{ title: "Owezy Pro", animation: 'slide_from_bottom' }} />
      <Stack.Screen name="edit" options={{ title: "Edit Profile", presentation: "modal" }} />
    </Stack>
  );
}
