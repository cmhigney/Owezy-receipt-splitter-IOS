Pod::Spec.new do |s|
  s.name           = 'AppleVisionOCR'
  s.version        = '1.0.0'
  s.summary        = 'Local Expo module for on-device Apple Vision OCR'
  s.description    = 'Local Expo module for on-device Apple Vision OCR'
  s.license        = 'MIT'
  s.author         = 'Owezy'
  s.homepage       = 'https://owezy.app'
  s.platforms      = {
    :ios => '15.1'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/expo/expo.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
