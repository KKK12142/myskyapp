import * as Astronomy from "astronomy-engine";
import starData from "./assets/hygdata_v3.json";

// 태양계 천체 정보 (기본 정보)
export const solarSystemBodies = [
  { id: "sun", proper: "태양", name: "Sun", mag: -26.7 },
  { id: "moon", proper: "달", name: "Moon", mag: -12.6 },
  { id: "mercury", proper: "수성", name: "Mercury", mag: -0.5 },
  { id: "venus", proper: "금성", name: "Venus", mag: -4.4 },
  { id: "mars", proper: "화성", name: "Mars", mag: 0.7 },
  { id: "jupiter", proper: "목성", name: "Jupiter", mag: -2.2 },
  { id: "saturn", proper: "토성", name: "Saturn", mag: 0.5 },
  { id: "uranus", proper: "천왕성", name: "Uranus", mag: 5.6 },
  { id: "neptune", proper: "해왕성", name: "Neptune", mag: 7.8 },
  { id: "pluto", proper: "명왕성", name: "Pluto", mag: 14.3 },
];

// 천체 이름을 Astro.Body 상수로 변환하는 함수
export const getBodyForName = (name) => {
  const bodyName = name.toLowerCase();
  switch (bodyName) {
    case "sun":
      return Astronomy.Body.Sun;
    case "moon":
      return Astronomy.Body.Moon;
    case "mercury":
      return Astronomy.Body.Mercury;
    case "venus":
      return Astronomy.Body.Venus;
    case "mars":
      return Astronomy.Body.Mars;
    case "jupiter":
      return Astronomy.Body.Jupiter;
    case "saturn":
      return Astronomy.Body.Saturn;
    case "uranus":
      return Astronomy.Body.Uranus;
    case "neptune":
      return Astronomy.Body.Neptune;
    case "pluto":
      return Astronomy.Body.Pluto;
    default:
      return null;
  }
};

// 태양계 천체의 실시간 위치 계산 함수
export const calculateSolarSystemBodyPosition = (
  bodyName,
  observer,
  date = new Date()
) => {
  if (!observer) {
    console.warn("관측자 정보가 없습니다");
    return null;
  }
  if (!bodyName) {
    console.warn("천체 이름이 없습니다");
    return null;
  }

  try {
    const body = getBodyForName(bodyName);
    if (!body) {
      console.warn(`지원하지 않는 천체 이름: ${bodyName}`);
      return null;
    }

    // 천체 위치 계산 - Astro.Equator 함수를 사용하여 적경과 적위 계산
    const equ = Astronomy.Equator(body, date, observer, true, true);

    // 적경과 적위 반환
    return {
      ra: equ.ra,
      dec: equ.dec,
    };
  } catch (error) {
    console.error(`천체 위치 계산 중 오류: ${error}`, bodyName);
    return null;
  }
};

// 모든 태양계 천체 위치 계산
export const getAllSolarSystemBodiesPositions = (observer) => {
  if (!observer) return [];

  return solarSystemBodies
    .map((body) => {
      try {
        const position = calculateSolarSystemBodyPosition(body.name, observer);
        if (!position) return null;

        return {
          ...body,
          ra: position.ra,
          dec: position.dec,
          isSolarSystemBody: true,
        };
      } catch (error) {
        console.error(`천체 위치 계산 오류 (${body.name}):`, error);
        return null;
      }
    })
    .filter((body) => body !== null);
};

// 검색 기능 - 태양계 천체 및 별 데이터에서 검색
export const searchCelestial = (query, observer) => {
  if (!query || query.length < 2) return [];
  if (!observer) return [];

  const lowerText = query.toLowerCase();
  const results = [];

  try {
    // 1. 태양계 천체 검색
    const solarSystemResults = solarSystemBodies
      .filter(
        (body) =>
          body.proper.toLowerCase().includes(lowerText) ||
          body.name.toLowerCase().includes(lowerText)
      )
      .map((body) => {
        try {
          const realTimePosition = calculateSolarSystemBodyPosition(
            body.name,
            observer
          );
          if (!realTimePosition) return null;

          return {
            id: body.id,
            proper: body.proper,
            name: body.name,
            mag: body.mag,
            ra: realTimePosition.ra,
            dec: realTimePosition.dec,
            isSolarSystemBody: true,
          };
        } catch (error) {
          console.error(`천체 위치 계산 오류 (${body.name}):`, error);
          return null;
        }
      })
      .filter((body) => body !== null);

    results.push(...solarSystemResults);
  } catch (error) {
    console.error("태양계 천체 검색 중 오류:", error);
  }

  try {
    // 2. 일반 항성 데이터 검색 (starData 사용)
    const starResults = starData
      .filter((item) => {
        // 태양계 천체는 건너뛰기 (이미 위에서 처리)
        const isSolarSystemBody = solarSystemBodies.some(
          (body) =>
            body.name.toLowerCase() === item.name?.toLowerCase() ||
            body.proper?.toLowerCase() === item.proper?.toLowerCase()
        );
        if (isSolarSystemBody) return false;

        // 이름 기반 검색
        const proper = item.proper?.toLowerCase() || "";
        const name = item.name?.toLowerCase() || "";

        return proper.includes(lowerText) || name.includes(lowerText);
      })
      .slice(0, 20)
      .map((star) => ({
        id: star.id || star.proper || star.name,
        proper: star.proper,
        name: star.name,
        mag: star.mag,
        ra: star.ra,
        dec: star.dec,
        isSolarSystemBody: false,
      }));

    results.push(...starResults);
  } catch (error) {
    console.error("항성 검색 중 오류:", error);
  }

  // 밝기 순으로 정렬
  return results.sort((a, b) => (a.mag || 100) - (b.mag || 100)).slice(0, 15);
};

// 기본 데이터 내보내기
export default {
  solarSystemBodies,
  starData,
  calculateSolarSystemBodyPosition,
  getAllSolarSystemBodiesPositions,
  searchCelestial,
};
