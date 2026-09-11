package cn.welink.app;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;

/** Installs the packaged UI before the local server can serve any of its files. */
final class UiAssets {
    interface Source {
        String[] list(String path) throws IOException;
        InputStream open(String path) throws IOException;
    }

    static void install(Source source, File destination) throws IOException {
        File root = destination.getCanonicalFile();
        String[] children = source.list("ui");
        if (children == null || children.length == 0) throw new IOException("安装包缺少界面资源");
        copyDirectory(source, "ui", root, root, children);
    }

    private static void copyDirectory(Source source, String path, File directory, File root, String[] children) throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建界面目录");
        for (String name : children) {
            if (name.isEmpty() || name.equals(".") || name.equals("..") || name.contains("/") || name.contains("\\"))
                throw new IOException("界面资源名称无效");
            String asset = path + "/" + name;
            File target = new File(directory, name).getCanonicalFile();
            if (!target.toPath().startsWith(root.toPath())) throw new IOException("界面资源路径无效");
            String[] nested = source.list(asset);
            if (nested != null && nested.length > 0) {
                copyDirectory(source, asset, target, root, nested);
                continue;
            }
            File temporary = File.createTempFile(".welink-asset-", ".new", directory);
            try {
                try (InputStream input = source.open(asset); OutputStream output = Files.newOutputStream(temporary.toPath())) {
                    byte[] buffer = new byte[65536];
                    for (int count; (count = input.read(buffer)) != -1;) output.write(buffer, 0, count);
                }
                try {
                    Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                } catch (AtomicMoveNotSupportedException unsupported) {
                    Files.move(temporary.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
                }
            } finally {
                Files.deleteIfExists(temporary.toPath());
            }
        }
    }
}
