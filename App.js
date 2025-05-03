import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  Animated,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { Accelerometer, Gyroscope, Magnetometer } from "expo-sensors";
import AHRS from "ahrs";
import * as Astro from "astronomy-engine";
import { Ionicons } from "@expo/vector-icons"; // Make sure to install this: npm install @expo/vector-icons

// Star database will be loaded from the asset
import starData from "./assets/hygdata_v3.json";

const SAMPLE_RATE_MS = 50; // 33 Hz – snappier response

export default function App() {
  /********************
   * 상태 변수
   *******************/
  const [cameraFacing, setCameraFacing] = useState("back");
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [locPerm, setLocPerm] = useState(false);
  const [observer, setObserver] = useState(null); // 위도·경도·고도
  const [declination, setDeclination] = useState(0); // 자기-진북 편각

  const [azAlt, setAzAlt] = useState({ az: 0, alt: 0 });
  const [eq, setEq] = useState({ ra: 0, dec: 0 });

  // 검색 관련 상태 변수
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCelestial, setSelectedCelestial] = useState(null);

  // 애니메이션 값
  const searchModalOpacity = useRef(new Animated.Value(0)).current;
  const searchModalScale = useRef(new Animated.Value(0.8)).current;

  /********************
   * AHRS 필터 준비
   *******************/
  const madgwick = useRef(
    new AHRS({
      sampleInterval: SAMPLE_RATE_MS,
      algorithm: "Madgwick", // Use Madgwick for beta gain
      beta: 0.45, // Faster convergence for 30 Hz
    })
  );

  // 최근 센서 값 저장용
  const last = useRef({ accel: null, gyro: null, mag: null });

  /********************
   * 위치·편각 초기화
   *******************/
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      setLocPerm(true);

      const pos = await Location.getCurrentPositionAsync({});
      setObserver(
        new Astro.Observer(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.altitude || 0
        )
      );

      // 편각 측정 (한 번만)
      const headingData = await Location.getHeadingAsync();
      if (
        headingData &&
        typeof headingData.trueHeading === "number" &&
        typeof headingData.magneticHeading === "number"
      ) {
        const dec = headingData.trueHeading - headingData.magneticHeading;
        setDeclination(dec);
      }
    })();
  }, []);

  /********************
   * 센서 구독 & 필터 갱신
   *******************/
  useEffect(() => {
    // helper to attempt fuse when all three latest present
    function tryFuse() {
      const { accel, gyro, mag } = last.current;
      if (!accel || !gyro || !mag) return;

      // Convert Expo (device) axes → NED axes expected by AHRS
      const aX = -accel.z,
        aY = accel.x,
        aZ = -accel.y; // m/s²
      const gX = -gyro.z,
        gY = gyro.x,
        gZ = -gyro.y; // rad/s
      const mX = -mag.z,
        mY = mag.x,
        mZ = -mag.y; // µT

      madgwick.current.update(gX, gY, gZ, aX, aY, aZ, mX, mY, mZ);

      // Use Euler angles for faster, more reliable altitude
      const { heading, pitch } = madgwick.current.getEulerAngles(); // rad
      // heading: +CW from north (west positive) → convert to CW East‑positive
      let azDeg = ((heading * 180) / Math.PI) % 360;
      azDeg = (azDeg + declination + 360) % 360; // declination correction

      // pitch is from vertical (+forward/down), we want altitude (+up). alt = -pitch
      const altDeg = (pitch * 180) / Math.PI;

      setAzAlt({ az: azDeg, alt: altDeg });
    }

    const accelSub = Accelerometer.addListener((d) => {
      last.current.accel = d;
      tryFuse();
    });
    const gyroSub = Gyroscope.addListener((d) => {
      // Expo Gyroscope already provides rad/s, 그대로 사용
      last.current.gyro = d;
      tryFuse();
    });
    const magSub = Magnetometer.addListener((d) => {
      last.current.mag = d;
      tryFuse();
    });

    Accelerometer.setUpdateInterval(SAMPLE_RATE_MS);
    Gyroscope.setUpdateInterval(SAMPLE_RATE_MS);
    Magnetometer.setUpdateInterval(SAMPLE_RATE_MS * 2); // 15 Hz

    return () => {
      accelSub.remove();
      gyroSub.remove();
      magSub.remove();
    };
  }, [declination]);

  /********************
   * 지평→적도 변환 (azAlt/observer 변경 시)
   *******************/
  useEffect(() => {
    if (!observer) return;
    const { az, alt } = azAlt;
    const time = new Date();

    const sph = new Astro.Spherical(alt, az, 1);
    const vHor = Astro.VectorFromHorizon(sph, time, null);
    const rot = Astro.Rotation_HOR_EQD(time, observer);
    const vEq = Astro.RotateVector(rot, vHor);
    let { ra, dec } = Astro.EquatorFromVector(vEq);
    // ra = (24 - ra) % 24;
    setEq({ ra, dec });
  }, [azAlt, observer]);

  /********************
   * 검색 기능
   *******************/
  // 검색창 토글
  const toggleSearch = () => {
    Animated.parallel([
      Animated.timing(searchModalOpacity, {
        toValue: showSearch ? 0 : 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.spring(searchModalScale, {
        toValue: showSearch ? 0.8 : 1,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();

    setShowSearch(!showSearch);
    if (showSearch) {
      setSearchQuery("");
      setSearchResults([]);
    }
  };

  // 검색어 처리
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const filteredResults = starData
      .filter(
        (star) =>
          (star.proper &&
            star.proper.toLowerCase().includes(searchQuery.toLowerCase())) ||
          (star.name &&
            star.name.toLowerCase().includes(searchQuery.toLowerCase()))
      )
      .slice(0, 20); // 상위 20개 결과만

    setSearchResults(filteredResults);
  }, [searchQuery]);

  // 천체 선택 처리
  const selectCelestial = (celestial) => {
    setSelectedCelestial(celestial);
    toggleSearch(); // 검색창 닫기
  };

  // 방향 차이 계산 (천체가 선택되었을 때)
  const calculateDirection = () => {
    if (!selectedCelestial || !eq) return null;

    // RA는 시간 단위(0-24h)에서 각도(0-360)로 변환
    const targetRaDeg = selectedCelestial.ra * 15; // 1h = 15°
    const currentRaDeg = eq.ra * 15;

    // 적경 차이 계산 (-180 ~ 180 범위)
    let raDiff = targetRaDeg - currentRaDeg;
    if (raDiff > 180) raDiff -= 360;
    if (raDiff < -180) raDiff += 360;

    // 적위 차이 계산
    const decDiff = selectedCelestial.dec - eq.dec;

    // 각도 차이의 크기
    const distance = Math.sqrt(raDiff * raDiff + decDiff * decDiff);

    // 방향 (상대적인 방향을 화살표로 표시)
    const direction = {
      vertical: decDiff > 1 ? "↑" : decDiff < -1 ? "↓" : "•",
      horizontal: raDiff > 1 ? "→" : raDiff < -1 ? "←" : "•",
    };

    // 방향각 계산 (라디안) - 화살표 위치 계산에 사용
    const angle = Math.atan2(decDiff, raDiff);

    return {
      raDiff,
      decDiff,
      distance,
      direction,
      angle, // 방향 각도 (라디안)
      angleDeg: ((angle * 180) / Math.PI + 360) % 360, // 방향 각도 (도)
    };
  };

  const directionInfo = selectedCelestial ? calculateDirection() : null;

  // 화살표 위치 계산 (원의 가장자리에 위치)
  const calculateArrowPosition = (angle, radius) => {
    // 시계방향으로 0도는 오른쪽(동), 90도는 위(북)에 대응하도록 조정
    const adjustedAngle = ((angle - 90) * Math.PI) / 180;
    return {
      x: Math.cos(adjustedAngle) * radius,
      y: Math.sin(adjustedAngle) * radius,
    };
  };

  // 나침반 렌더링 여부
  const showCompass =
    selectedCelestial && directionInfo && directionInfo.distance > 0.5;

  /********************
   * 권한 처리
   *******************/
  if (!camPerm?.granted) {
    return (
      <View style={styles.center}>
        <Text>카메라 권한이 필요합니다</Text>
        <TouchableOpacity onPress={requestCamPerm}>
          <Text style={{ color: "blue" }}>권한 요청</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!locPerm || !observer) {
    return (
      <View style={styles.center}>
        <Text>위치 권한/데이터 로딩 중...</Text>
      </View>
    );
  }

  /********************
   * UI 렌더링
   *******************/
  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing={cameraFacing}></CameraView>
      <View style={styles.overlay}>
        <Text style={styles.txt}>방위각: {azAlt.az.toFixed(1)}°</Text>
        <Text style={styles.txt}>고도각: {azAlt.alt.toFixed(1)}°</Text>
        <Text style={styles.txt}>적경: {eq.ra.toFixed(2)}h</Text>
        <Text style={styles.txt}>적위: {eq.dec.toFixed(2)}°</Text>

        {selectedCelestial && directionInfo && (
          <>
            <Text style={styles.txtHeader}>
              선택된 천체: {selectedCelestial.proper || selectedCelestial.name}
            </Text>
            <Text style={styles.txt}>
              적경: {selectedCelestial.ra.toFixed(2)}h
            </Text>
            <Text style={styles.txt}>
              적위: {selectedCelestial.dec.toFixed(2)}°
            </Text>

            <Text style={styles.txt}>
              방향: {directionInfo.angleDeg.toFixed(0)}°
            </Text>
          </>
        )}
      </View>

      {/* 방향 나침반 (화면 중앙) */}
      {showCompass && (
        <View style={styles.compassContainer}>
          {/* 원형 테두리 */}
          <View style={styles.compassCircle} />

          {/* 중앙 십자선 */}
          <View style={styles.crosshairHorizontal} />
          <View style={styles.crosshairVertical} />

          {/* 방향 화살표 */}
          <View
            style={[
              styles.directionArrow,
              {
                transform: [
                  {
                    translateX: calculateArrowPosition(
                      directionInfo.angleDeg,
                      120
                    ).x,
                  },
                  {
                    translateY: calculateArrowPosition(
                      directionInfo.angleDeg,
                      120
                    ).y,
                  },
                  { rotate: `${directionInfo.angleDeg}deg` },
                ],
              },
            ]}
          />

          {/* 천체 명칭 표시 */}
          <View
            style={[
              styles.celestialLabel,
              {
                transform: [
                  {
                    translateX: calculateArrowPosition(
                      directionInfo.angleDeg,
                      150
                    ).x,
                  },
                  {
                    translateY: calculateArrowPosition(
                      directionInfo.angleDeg,
                      150
                    ).y,
                  },
                ],
              },
            ]}
          >
            <Text style={styles.celestialLabelText}>
              {selectedCelestial.proper || selectedCelestial.name}
            </Text>
            <Text style={styles.txt}>
              거리: {directionInfo.distance.toFixed(1)}°
            </Text>
          </View>
        </View>
      )}

      {/* 검색 버튼 (오른쪽 상단) */}
      <TouchableOpacity style={styles.searchButton} onPress={toggleSearch}>
        <Ionicons name="search" size={24} color="white" />
      </TouchableOpacity>

      {/* 검색 모달 (화면 중앙) */}
      {showSearch && (
        <TouchableOpacity
          style={styles.modalBackdrop}
          activeOpacity={1}
          onPress={toggleSearch}
        >
          <Animated.View
            style={[
              styles.searchModal,
              {
                opacity: searchModalOpacity,
                transform: [{ scale: searchModalScale }],
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={styles.modalContent}
              onPress={(e) => e.stopPropagation()} // 모달 내부 클릭 시 닫히지 않게
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>별 검색</Text>
                <TouchableOpacity onPress={toggleSearch}>
                  <Ionicons name="close" size={24} color="white" />
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.searchInput}
                placeholder="별 이름 검색..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholderTextColor="#999"
                autoFocus={true}
              />

              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.resultItem}
                    onPress={() => selectCelestial(item)}
                  >
                    <Text style={styles.resultName}>
                      {item.proper || item.name}
                    </Text>
                    <Text style={styles.resultInfo}>
                      적경: {item.ra.toFixed(2)}h, 적위: {item.dec.toFixed(2)}°,
                      등급: {item.mag.toFixed(1)}
                    </Text>
                  </TouchableOpacity>
                )}
                style={styles.resultsList}
              />
            </TouchableOpacity>
          </Animated.View>
        </TouchableOpacity>
      )}
    </View>
  );
}

/********************
 * 스타일
 *******************/
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  camera: {
    flex: 1,
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  overlay: {
    position: "absolute",
    top: 40,
    left: 20,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 10,
    borderRadius: 8,
  },
  txt: { color: "#fff", fontSize: 14, marginBottom: 4 },
  txtHeader: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 4,
  },
  txtDirection: {
    color: "#fff",
    fontSize: 32,
    textAlign: "center",
    marginTop: 5,
  },
  searchButton: {
    position: "absolute",
    top: 40,
    right: 20,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 10,
    borderRadius: 25,
  },
  flipButton: {
    position: "absolute",
    bottom: 30,
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  btnText: { color: "#fff", fontSize: 16 },
  modalBackdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
  },
  searchModal: {
    width: "85%",
    maxHeight: "70%",
    backgroundColor: "rgba(20,20,30,0.95)",
    borderRadius: 15,
    overflow: "hidden",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  modalContent: {
    padding: 0,
    width: "100%",
    height: "100%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#444",
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  resultsList: {
    maxHeight: "80%",
  },
  searchInput: {
    backgroundColor: "#333",
    margin: 15,
    marginTop: 5,
    color: "#fff",
    borderRadius: 8,
    padding: 10,
  },
  resultItem: {
    padding: 10,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  resultName: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  resultInfo: {
    color: "#ccc",
    fontSize: 12,
  },
  // 나침반 스타일
  compassContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    pointerEvents: "none", // 터치 이벤트 통과
  },
  compassCircle: {
    width: 250,
    height: 250,
    borderRadius: 125,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.5)",
    backgroundColor: "transparent",
  },
  crosshairHorizontal: {
    position: "absolute",
    width: 20,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.5)",
  },
  crosshairVertical: {
    position: "absolute",
    width: 1,
    height: 20,
    backgroundColor: "rgba(255, 255, 255, 0.5)",
  },
  directionArrow: {
    position: "absolute",
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 16,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "rgba(255, 255, 0, 0.8)",
  },
  celestialLabel: {
    position: "absolute",
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  celestialLabelText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
    textAlign: "center",
  },
});
