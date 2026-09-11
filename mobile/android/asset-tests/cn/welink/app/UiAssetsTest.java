package cn.welink.app;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class UiAssetsTest {
    public static void main(String[] args) throws Exception {
        Path temporary = Files.createTempDirectory("welink-assets-");
        try (ZipFile apk = new ZipFile(args[0])) {
            Map<String, byte[]> files = new TreeMap<>();
            Enumeration<? extends ZipEntry> entries = apk.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (!entry.isDirectory() && entry.getName().startsWith("assets/ui/"))
                    try (InputStream input = apk.getInputStream(entry)) { files.put(entry.getName().substring(7), input.readAllBytes()); }
            }
            check(files.keySet().stream().filter(name -> name.startsWith("ui/avatars/")).count() == 100, "100 packaged avatar files");
            MemorySource source = new MemorySource(files);
            File destination = temporary.resolve("ui").toFile();
            // A directory cannot be opened as a file, as with Android AssetManager.
            expectFailure(() -> source.open("ui/avatars"));
            UiAssets.install(source, destination);
            for (Map.Entry<String, byte[]> entry : files.entrySet())
                check(Arrays.equals(Files.readAllBytes(temporary.resolve(entry.getKey())), entry.getValue()), entry.getKey());
            Files.writeString(temporary.resolve("ui/index.html"), "previous installation");
            UiAssets.install(source, destination);
            check(Arrays.equals(Files.readAllBytes(temporary.resolve("ui/index.html")), files.get("ui/index.html")), "upgrade replaces old UI");
            Map<String, byte[]> retryFiles = new TreeMap<>();
            retryFiles.put("ui/index.html", "complete update".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            MemorySource broken = new MemorySource(retryFiles) {
                @Override public InputStream open(String path) { return new InputStream() {
                    private int remaining=4;
                    @Override public int read() throws IOException { if(remaining-- > 0)return 'x';throw new IOException("interrupted asset read"); }
                }; }
            };
            expectFailure(() -> UiAssets.install(broken, destination));
            check(Arrays.equals(Files.readAllBytes(temporary.resolve("ui/index.html")), files.get("ui/index.html")), "failed copy retains complete previous file");
            try (java.util.stream.Stream<Path> paths=Files.walk(destination.toPath())) {
                check(paths.noneMatch(path -> path.getFileName().toString().startsWith(".welink-asset-")), "failed copy removes temporary file");
            }
            UiAssets.install(new MemorySource(retryFiles), destination);
            check(Files.readString(temporary.resolve("ui/index.html")).equals("complete update"), "retry succeeds");
            expectFailure(() -> UiAssets.install(new MemorySource(Collections.singletonMap("ui/../escape",new byte[]{1})),destination));
            System.out.println("PASS: " + files.size() + " APK UI resources, 100 nested avatars, upgrade, interrupted-copy cleanup, retry and path validation");
        } finally {
            try (java.util.stream.Stream<Path> paths=Files.walk(temporary)) {
                for(Path path:paths.sorted(Comparator.reverseOrder()).toArray(Path[]::new))Files.delete(path);
            }
        }
    }
    interface Throwing { void run() throws IOException; }
    private static void expectFailure(Throwing operation) throws IOException { try { operation.run(); } catch(IOException expected) { return; }throw new AssertionError("expected IOException"); }
    private static void check(boolean condition,String message) { if(!condition)throw new AssertionError(message); }
    private static class MemorySource implements UiAssets.Source {
        private final Map<String,byte[]> files;
        MemorySource(Map<String,byte[]> files){this.files=files;}
        public String[] list(String path) {
            Set<String> children=new TreeSet<>();String prefix=path+"/";
            for(String key:files.keySet())if(key.startsWith(prefix)){String child=key.substring(prefix.length());children.add(child.split("/",2)[0]);}
            return children.toArray(new String[0]);
        }
        public InputStream open(String path) throws IOException { byte[] value=files.get(path);if(value==null)throw new FileNotFoundException(path);return new ByteArrayInputStream(value); }
    }
}
