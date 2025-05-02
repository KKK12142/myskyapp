import React, { useState, useEffect, useRef } from "react";
import { StyleSheet, View, Text, TouchableOpacity } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import { Accelerometer, Gyroscope, Magnetometer } from "expo-sensors";
import AHRS from "ahrs";
import * as Astro from "astronomy-engine";

const SAMPLE_RATE_MS = 50; // 33 Hz – snappier response

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

  /********************
   * AHRS 필터 준비
   *******************/
  const madgwick = useRef(
    new AHRS({
      sampleInterval: SAMPLE_RATE_MS,
      algorithm: "Madgwick", // Use Madgwick for beta gain
      beta: 0.45, // Faster convergence for 30 Hz
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
    Magnetometer.setUpdateInterval(SAMPLE_RATE_MS * 2); // 15 Hz

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
      <CameraView style={styles.camera} facing={cameraFacing}>
        <View style={styles.overlay}>
          <Text style={styles.txt}>방위각: {azAlt.az.toFixed(1)}°</Text>
          <Text style={styles.txt}>고도각: {azAlt.alt.toFixed(1)}°</Text>
          <Text style={styles.txt}>적경: {eq.ra.toFixed(2)}h</Text>
          <Text style={styles.txt}>적위: {eq.dec.toFixed(2)}°</Text>
        </View>
        <TouchableOpacity
          style={styles.button}
          onPress={() =>
            setCameraFacing((p) => (p === "back" ? "front" : "back"))
          }
        >
          <Text style={styles.btnText}>Flip</Text>
        </TouchableOpacity>
      </CameraView>
    </View>
  );
}

/********************
 * 스타일
 *******************/
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  camera: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 40,
    left: 20,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 10,
    borderRadius: 8,
  },
  txt: { color: "#fff", fontSize: 14, marginBottom: 4 },
  button: {
    position: "absolute",
    bottom: 30,
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  btnText: { color: "#fff", fontSize: 16 },
});
