
export default function SearchModal() {
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
  return <View></View>;
}

const styles = StyleSheet.create({